const METER_TYPES = new Set(["electric", "gas"]);
const SETTING_DEFAULTS = {
  caiyunApiKey: "",
  address: {
    province: "",
    city: "",
    district: "",
    street: "",
    detail: "",
  },
  location: null,
  electricInitialComplete: false,
  gasInitialComplete: false,
  electricLastPromptDate: "",
  gasLastPromptDate: "",
  forecast: {
    sensitivity: 2.5,
    baselineDays: 14,
  },
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env, url).catch((error) => {
        console.error(error);
        return jsonResponse({ error: error.message || "Server error" }, error.status || 500);
      });
    }

    return env.ASSETS.fetch(request);
  },
};

async function handleApi(request, env, url) {
  if (!env.DB) {
    return jsonResponse({ error: "D1 database binding DB is missing" }, 500);
  }

  const path = url.pathname.replace(/^\/api\/?/, "");

  if (request.method === "GET" && path === "state") {
    const [settings, electricReadings, gasReadings] = await Promise.all([
      getSettings(env.DB),
      listReadings(env.DB, "electric"),
      listReadings(env.DB, "gas"),
    ]);

    return jsonResponse({
      settings: publicSettings(settings),
      readings: {
        electric: electricReadings,
        gas: gasReadings,
      },
    });
  }

  if (request.method === "PUT" && path === "settings") {
    const body = await readJson(request);
    const existing = await getSettings(env.DB);
    const next = sanitizeSettings({ ...existing, ...body });

    if (body.caiyunApiKey !== undefined) {
      next.caiyunApiKey = String(body.caiyunApiKey || "").trim();
    }

    let warning = null;
    if (body.address !== undefined) {
      next.address = sanitizeAddress(body.address);
      const nextText = addressToText(next.address);
      const prevText = addressToText(existing.address || {});

      if (!nextText) {
        // 地址被清空：清除经纬度，无需调用外部服务
        next.location = null;
      } else if (nextText !== prevText) {
        // 地址文本变化时才重新解析；失败不阻断其它设置的保存
        try {
          next.location = await geocodeAddress(next.address);
        } catch (error) {
          warning = error.message || "地址解析失败，已保留上一次的经纬度";
        }
      }
    }

    await setSettings(env.DB, next);
    return jsonResponse({ settings: publicSettings(next), ...(warning ? { warning } : {}) });
  }

  if (request.method === "POST" && path === "settings/geocode") {
    const body = await readJson(request);
    const address = sanitizeAddress(body.address || {});
    const location = await geocodeAddress(address);
    const settings = await getSettings(env.DB);
    await setSettings(env.DB, { ...settings, address, location });
    return jsonResponse({ location, address });
  }

  if (request.method === "GET" && path === "weather") {
    const settings = await getSettings(env.DB);
    if (!settings.caiyunApiKey) {
      return jsonResponse({ error: "请先在设置中填写彩云天气 API 密钥" }, 400);
    }
    if (!settings.location) {
      return jsonResponse({ error: "请先填写结构化地址并获取经纬度" }, 400);
    }

    const weather = await fetchCaiyunWeather(settings.location, settings.caiyunApiKey);
    return jsonResponse({ weather, location: settings.location });
  }

  const readingsMatch = path.match(/^readings\/(electric|gas)$/);
  if (readingsMatch && request.method === "GET") {
    return jsonResponse({ readings: await listReadings(env.DB, readingsMatch[1]) });
  }

  if (readingsMatch && request.method === "POST") {
    const meterType = readingsMatch[1];
    const body = await readJson(request);
    const reading = sanitizeReading(meterType, body);
    await assertReadingOrder(env.DB, reading);

    const existing = await env.DB.prepare(
      "SELECT is_initial FROM readings WHERE meter_type = ?1 AND reading_date = ?2",
    )
      .bind(meterType, reading.readingDate)
      .first();

    await env.DB.prepare(
      `INSERT INTO readings (meter_type, reading_date, value, is_initial, updated_at)
       VALUES (?1, ?2, ?3, ?4, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
       ON CONFLICT(meter_type, reading_date)
       DO UPDATE SET
         value = excluded.value,
         is_initial = excluded.is_initial,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    )
      .bind(meterType, reading.readingDate, reading.value, reading.isInitial ? 1 : existing?.is_initial || 0)
      .run();

    return jsonResponse({ readings: await listReadings(env.DB, meterType) });
  }

  const initialMatch = path.match(/^readings\/(electric|gas)\/initial$/);
  if (initialMatch && request.method === "PUT") {
    const meterType = initialMatch[1];
    const body = await readJson(request);
    const reading = sanitizeReading(meterType, { ...body, isInitial: true });
    await assertReadingOrder(env.DB, reading, true);

    await env.DB.batch([
      env.DB.prepare("DELETE FROM readings WHERE meter_type = ?1 AND is_initial = 1 AND reading_date <> ?2").bind(
        meterType,
        reading.readingDate,
      ),
      env.DB.prepare(
        `INSERT INTO readings (meter_type, reading_date, value, is_initial, updated_at)
         VALUES (?1, ?2, ?3, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
         ON CONFLICT(meter_type, reading_date)
         DO UPDATE SET
           value = excluded.value,
           is_initial = 1,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
      ).bind(meterType, reading.readingDate, reading.value),
    ]);

    const settings = await getSettings(env.DB);
    await setSettings(env.DB, {
      ...settings,
      [`${meterType}InitialComplete`]: true,
      [`${meterType}LastPromptDate`]: reading.readingDate === todayInHongKong() ? reading.readingDate : settings[`${meterType}LastPromptDate`],
    });

    return jsonResponse({
      readings: await listReadings(env.DB, meterType),
      settings: publicSettings(await getSettings(env.DB)),
    });
  }

  const deleteMatch = path.match(/^readings\/(electric|gas)\/([^/]+)$/);
  if (deleteMatch && request.method === "DELETE") {
    const [, meterType, readingDate] = deleteMatch;
    const existing = await env.DB.prepare(
      "SELECT is_initial FROM readings WHERE meter_type = ?1 AND reading_date = ?2",
    )
      .bind(meterType, readingDate)
      .first();

    if (existing?.is_initial) {
      return jsonResponse({ error: "初始读数请在设置中修改" }, 400);
    }

    await env.DB.prepare("DELETE FROM readings WHERE meter_type = ?1 AND reading_date = ?2")
      .bind(meterType, readingDate)
      .run();

    return jsonResponse({ readings: await listReadings(env.DB, meterType) });
  }

  if (request.method === "POST" && path === "prompt") {
    const body = await readJson(request);
    const meterType = assertMeterType(body.meterType);
    const settings = await getSettings(env.DB);
    await setSettings(env.DB, {
      ...settings,
      [`${meterType}LastPromptDate`]: String(body.date || todayInHongKong()),
    });
    return jsonResponse({ settings: publicSettings(await getSettings(env.DB)) });
  }

  return jsonResponse({ error: "Not found" }, 404);
}

async function getSettings(db) {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'app'").first();
  if (!row?.value) return { ...SETTING_DEFAULTS };

  try {
    return sanitizeSettings(JSON.parse(row.value));
  } catch {
    return { ...SETTING_DEFAULTS };
  }
}

async function setSettings(db, settings) {
  const value = JSON.stringify(sanitizeSettings(settings));
  await db.prepare(
    `INSERT INTO settings (key, value, updated_at)
     VALUES ('app', ?1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     ON CONFLICT(key)
     DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  )
    .bind(value)
    .run();
}

async function listReadings(db, meterType) {
  assertMeterType(meterType);
  const { results } = await db.prepare(
    `SELECT
       meter_type AS meterType,
       reading_date AS date,
       value,
       is_initial AS isInitial,
       created_at AS createdAt,
       updated_at AS updatedAt
     FROM readings
     WHERE meter_type = ?1
     ORDER BY reading_date ASC`,
  )
    .bind(meterType)
    .all();

  return (results || []).map((row) => ({
    ...row,
    value: Number(row.value),
    isInitial: Boolean(row.isInitial),
  }));
}

async function assertReadingOrder(db, reading, ignoreInitial = false) {
  const unit = reading.meterType === "gas" ? "m³" : "kWh";
  const previous = await db.prepare(
    `SELECT reading_date AS date, value
     FROM readings
     WHERE meter_type = ?1 AND reading_date < ?2
     ${ignoreInitial ? "AND is_initial = 0" : ""}
     ORDER BY reading_date DESC
     LIMIT 1`,
  )
    .bind(reading.meterType, reading.readingDate)
    .first();

  if (previous && reading.value < Number(previous.value)) {
    throw new ApiError(`读数不能小于上一条 ${formatNumber(previous.value)} ${unit}`, 400);
  }

  const next = await db.prepare(
    `SELECT reading_date AS date, value
     FROM readings
     WHERE meter_type = ?1 AND reading_date > ?2
     ${ignoreInitial ? "AND is_initial = 0" : ""}
     ORDER BY reading_date ASC
     LIMIT 1`,
  )
    .bind(reading.meterType, reading.readingDate)
    .first();

  if (next && reading.value > Number(next.value)) {
    throw new ApiError(`读数不能大于后一条 ${formatNumber(next.value)} ${unit}`, 400);
  }
}

function sanitizeReading(meterType, body) {
  const safeMeterType = assertMeterType(meterType);
  const readingDate = String(body.date || body.readingDate || "");
  const value = Number(body.value);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(readingDate)) {
    throw new ApiError("请选择有效日期", 400);
  }

  if (!Number.isFinite(value) || value < 0) {
    throw new ApiError("请输入有效读数", 400);
  }

  return {
    meterType: safeMeterType,
    readingDate,
    value: round(value),
    isInitial: Boolean(body.isInitial),
  };
}

function sanitizeSettings(settings) {
  return {
    ...SETTING_DEFAULTS,
    ...settings,
    caiyunApiKey: String(settings.caiyunApiKey || ""),
    address: sanitizeAddress(settings.address || {}),
    location: sanitizeLocation(settings.location),
    electricInitialComplete: Boolean(settings.electricInitialComplete),
    gasInitialComplete: Boolean(settings.gasInitialComplete),
    electricLastPromptDate: String(settings.electricLastPromptDate || ""),
    gasLastPromptDate: String(settings.gasLastPromptDate || ""),
    forecast: {
      ...SETTING_DEFAULTS.forecast,
      ...(settings.forecast || {}),
      sensitivity: Number(settings.forecast?.sensitivity ?? SETTING_DEFAULTS.forecast.sensitivity),
      baselineDays: Number(settings.forecast?.baselineDays ?? SETTING_DEFAULTS.forecast.baselineDays),
    },
  };
}

function sanitizeAddress(address) {
  return {
    province: String(address.province || "").trim(),
    city: String(address.city || "").trim(),
    district: String(address.district || "").trim(),
    street: String(address.street || "").trim(),
    detail: String(address.detail || "").trim(),
  };
}

function sanitizeLocation(location) {
  if (!location) return null;
  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return {
    latitude,
    longitude,
    addressText: String(location.addressText || ""),
    provider: String(location.provider || ""),
  };
}

function publicSettings(settings) {
  const safe = sanitizeSettings(settings);
  return {
    ...safe,
    caiyunApiKey: safe.caiyunApiKey ? "********" : "",
    hasCaiyunApiKey: Boolean(safe.caiyunApiKey),
  };
}

async function geocodeAddress(address) {
  const text = addressToText(address);
  if (!text) {
    throw new ApiError("请填写结构化地址", 400);
  }

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("accept-language", "zh-CN");
  url.searchParams.set("q", text);

  const response = await fetch(url, {
    headers: {
      "User-Agent": "meter-usage-dashboard/1.0",
    },
  });

  if (!response.ok) {
    throw new ApiError("地址解析服务暂不可用", 502);
  }

  const data = await response.json();
  const hit = Array.isArray(data) ? data[0] : null;
  if (!hit) {
    throw new ApiError("未能根据地址获取经纬度", 400);
  }

  return {
    latitude: Number(hit.lat),
    longitude: Number(hit.lon),
    addressText: hit.display_name || text,
    provider: "OpenStreetMap Nominatim",
  };
}

async function fetchCaiyunWeather(location, token) {
  const url = new URL(
    `https://api.caiyunapp.com/v2.6/${encodeURIComponent(token)}/${Number(location.longitude).toFixed(5)},${Number(location.latitude).toFixed(5)}/weather`,
  );
  url.searchParams.set("dailysteps", "7");
  url.searchParams.set("hourlysteps", "1");
  url.searchParams.set("alert", "false");
  url.searchParams.set("unit", "metric:v2");

  const response = await fetch(url);
  if (!response.ok) {
    throw new ApiError(`彩云天气接口返回 ${response.status}`, 502);
  }

  const data = await response.json();
  if (data.status !== "ok") {
    throw new ApiError(data.error || "彩云天气返回异常", 502);
  }

  const daily = data.result?.daily || {};
  const temperature = daily.temperature || [];
  const skycon = daily.skycon || [];

  return {
    source: "彩云天气",
    updatedAt: new Date().toISOString(),
    daily: temperature.slice(0, 7).map((item, index) => ({
      date: String(item.date || skycon[index]?.date || "").slice(0, 10),
      temperatureMax: item.max,
      temperatureMin: item.min,
      weatherCode: skycon[index]?.value || "",
    })),
  };
}

function addressToText(address) {
  return [address.province, address.city, address.district, address.street, address.detail].filter(Boolean).join("");
}

function assertMeterType(value) {
  if (!METER_TYPES.has(value)) {
    throw new ApiError("未知表类型", 400);
  }
  return value;
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new ApiError("请求体不是有效 JSON", 400);
  }
}

function jsonResponse(data, status = 200) {
  const actualStatus = data instanceof ApiError ? data.status : status;
  return new Response(JSON.stringify(data), {
    status: actualStatus,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function todayInHongKong() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function formatNumber(value) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(Number(value));
}

function round(value) {
  return Math.round(Number(value) * 100) / 100;
}

class ApiError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.status = status;
  }
}
