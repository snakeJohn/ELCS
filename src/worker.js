const METER_TYPES = new Set(["electric", "gas"]);
const AUTH_USERNAME = "admin";
const INITIAL_PASSWORD = "password";
const SESSION_COOKIE_NAME = "elcs_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const PASSWORD_ITERATIONS = 90000;

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
        if (!(error instanceof ApiError)) {
          console.error(error);
        }
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

  if (path === "auth/status" || path.startsWith("auth/")) {
    return handleAuthApi(request, env.DB, path, url);
  }

  const authGate = await requireAppAccess(request, env.DB);
  if (authGate) return authGate;

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

  if (request.method === "PUT" && path === "settings/location") {
    const body = await readJson(request);
    const location = sanitizeSubmittedLocation(body);
    const settings = await getSettings(env.DB);
    const next = {
      ...settings,
      location,
    };

    await setSettings(env.DB, next);
    return jsonResponse({ settings: publicSettings(next) });
  }

  if (request.method === "GET" && path === "weather") {
    const settings = await getSettings(env.DB);
    if (!settings.caiyunApiKey) {
      return jsonResponse({ error: "请先在设置中填写彩云天气 API 密钥" }, 400);
    }
    if (!settings.location) {
      return jsonResponse({ error: "请先保存经纬度，可使用当前位置或手动填写坐标" }, 400);
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
    if (reading.isInitial) {
      throw new ApiError("初始读数请在设置中修改", 400);
    }
    await assertReadingOrder(env.DB, reading);

    const existing = await env.DB.prepare(
      "SELECT is_initial FROM readings WHERE meter_type = ?1 AND reading_date = ?2",
    )
      .bind(meterType, reading.readingDate)
      .first();

    if (existing?.is_initial) {
      throw new ApiError("初始读数请在设置中修改", 400);
    }

    await env.DB.prepare(
      `INSERT INTO readings (meter_type, reading_date, value, is_initial, updated_at)
       VALUES (?1, ?2, ?3, ?4, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
       ON CONFLICT(meter_type, reading_date)
       DO UPDATE SET
         value = excluded.value,
         is_initial = excluded.is_initial,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    )
      .bind(meterType, reading.readingDate, reading.value, 0)
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
      [`${meterType}LastPromptDate`]: normalizePromptDate(body.date),
    });
    return jsonResponse({ settings: publicSettings(await getSettings(env.DB)) });
  }

  return jsonResponse({ error: "Not found" }, 404);
}

async function handleAuthApi(request, db, path, url) {
  if (request.method === "GET" && path === "auth/status") {
    const session = await getSessionFromRequest(db, request);
    return jsonResponse(authStatusPayload(session?.auth || null, Boolean(session)));
  }

  if (request.method === "POST" && path === "auth/login") {
    const body = await readJson(request);
    const username = String(body.username || "").trim();
    const password = String(body.password || "");

    if (username !== AUTH_USERNAME || !password) {
      return jsonResponse({ error: "用户名或密码错误" }, 401);
    }

    let auth = await getAuthState(db);
    if (!auth) {
      if (password !== INITIAL_PASSWORD) {
        return jsonResponse({ error: "用户名或密码错误" }, 401);
      }
      auth = {
        username: AUTH_USERNAME,
        passwordHash: await hashPassword(INITIAL_PASSWORD),
        mustChangePassword: true,
        sessions: {},
      };
    } else if (!(await verifyPassword(password, auth.passwordHash))) {
      return jsonResponse({ error: "用户名或密码错误" }, 401);
    }

    pruneExpiredSessions(auth);
    const token = createSessionToken();
    auth.sessions[token] = createSessionRecord();
    await setAuthState(db, auth);

    return jsonResponse(authStatusPayload(auth, true), 200, {
      "set-cookie": buildSessionCookie(token, request),
    });
  }

  if (request.method === "POST" && path === "auth/change-password") {
    const session = await getSessionFromRequest(db, request);
    if (!session) {
      return jsonResponse({ error: "请先登录" }, 401);
    }

    const body = await readJson(request);
    const currentPassword = String(body.currentPassword || "");
    const newPassword = String(body.newPassword || "");
    const confirmPassword = String(body.confirmPassword || "");

    if (!(await verifyPassword(currentPassword, session.auth.passwordHash))) {
      return jsonResponse({ error: "当前密码不正确" }, 401);
    }

    const validationError = validateNewPassword(newPassword, confirmPassword, currentPassword);
    if (validationError) {
      return jsonResponse({ error: validationError }, 400);
    }

    const auth = session.auth;
    auth.passwordHash = await hashPassword(newPassword);
    auth.mustChangePassword = false;
    auth.sessions = {};
    const token = createSessionToken();
    auth.sessions[token] = createSessionRecord();
    await setAuthState(db, auth);

    return jsonResponse(authStatusPayload(auth, true), 200, {
      "set-cookie": buildSessionCookie(token, request),
    });
  }

  if (request.method === "POST" && path === "auth/logout") {
    const token = getCookie(request, SESSION_COOKIE_NAME);
    const auth = await getAuthState(db);
    if (auth && token && auth.sessions[token]) {
      delete auth.sessions[token];
      await setAuthState(db, auth);
    }

    return jsonResponse({ authenticated: false, mustChangePassword: false, canUseApp: false }, 200, {
      "set-cookie": buildExpiredSessionCookie(request),
    });
  }

  return jsonResponse({ error: "Not found" }, 404);
}

async function requireAppAccess(request, db) {
  const session = await getSessionFromRequest(db, request);
  if (!session) {
    return jsonResponse({ error: "请先登录" }, 401);
  }
  if (session.auth.mustChangePassword) {
    return jsonResponse({ error: "请先修改初始密码", code: "PASSWORD_CHANGE_REQUIRED" }, 403);
  }
  return null;
}

async function getAuthState(db) {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'auth'").first();
  if (!row?.value) return null;

  try {
    return sanitizeAuthState(JSON.parse(row.value));
  } catch {
    throw new ApiError("认证配置已损坏，请在 D1 中重置管理员密码", 500);
  }
}

async function setAuthState(db, auth) {
  const value = JSON.stringify(sanitizeAuthState(auth));
  await db.prepare(
    `INSERT INTO settings (key, value, updated_at)
     VALUES ('auth', ?1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     ON CONFLICT(key)
     DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  )
    .bind(value)
    .run();
}

function sanitizeAuthState(auth) {
  const sessions = {};
  for (const [token, session] of Object.entries(auth?.sessions || {})) {
    if (!token || typeof token !== "string") continue;
    sessions[token] = {
      createdAt: String(session.createdAt || ""),
      expiresAt: String(session.expiresAt || ""),
    };
  }

  return {
    username: AUTH_USERNAME,
    passwordHash: sanitizePasswordHash(auth?.passwordHash),
    mustChangePassword: auth?.mustChangePassword !== false,
    sessions,
  };
}

function sanitizePasswordHash(passwordHash) {
  if (!passwordHash || typeof passwordHash !== "object") return null;
  return {
    algorithm: "PBKDF2-SHA256",
    iterations: Number(passwordHash.iterations || PASSWORD_ITERATIONS),
    salt: String(passwordHash.salt || ""),
    hash: String(passwordHash.hash || ""),
  };
}

async function getSessionFromRequest(db, request) {
  const token = getCookie(request, SESSION_COOKIE_NAME);
  if (!token) return null;

  const auth = await getAuthState(db);
  const session = auth?.sessions?.[token];
  if (!auth || !session) return null;

  if (!session.expiresAt || Date.parse(session.expiresAt) <= Date.now()) {
    delete auth.sessions[token];
    await setAuthState(db, auth);
    return null;
  }

  return { auth, token, session };
}

function authStatusPayload(auth, authenticated) {
  return {
    authenticated,
    username: authenticated ? AUTH_USERNAME : "",
    mustChangePassword: authenticated ? Boolean(auth?.mustChangePassword) : false,
    canUseApp: authenticated && !auth?.mustChangePassword,
  };
}

function validateNewPassword(newPassword, confirmPassword, currentPassword) {
  if (newPassword.length < 8) return "新密码至少需要 8 位";
  if (newPassword !== confirmPassword) return "两次输入的新密码不一致";
  if (newPassword === currentPassword) return "新密码不能与当前密码相同";
  if (newPassword === INITIAL_PASSWORD) return "不能继续使用初始密码";
  return "";
}

function createSessionRecord() {
  const now = Date.now();
  return {
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SESSION_TTL_SECONDS * 1000).toISOString(),
  };
}

function pruneExpiredSessions(auth) {
  for (const [token, session] of Object.entries(auth.sessions || {})) {
    if (!session.expiresAt || Date.parse(session.expiresAt) <= Date.now()) {
      delete auth.sessions[token];
    }
  }
}

function createSessionToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

async function hashPassword(password) {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const hash = await derivePasswordHash(password, salt, PASSWORD_ITERATIONS);
  return {
    algorithm: "PBKDF2-SHA256",
    iterations: PASSWORD_ITERATIONS,
    salt: bytesToBase64(salt),
    hash: bytesToBase64(hash),
  };
}

async function verifyPassword(password, passwordHash) {
  const safeHash = sanitizePasswordHash(passwordHash);
  if (!safeHash?.salt || !safeHash?.hash) return false;

  const salt = base64ToBytes(safeHash.salt);
  const expected = base64ToBytes(safeHash.hash);
  const actual = await derivePasswordHash(password, salt, safeHash.iterations);
  return constantTimeEqual(actual, expected);
}

async function derivePasswordHash(password, salt, iterations) {
  const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations,
    },
    keyMaterial,
    256,
  );
  return new Uint8Array(bits);
}

function constantTimeEqual(a, b) {
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    diff |= (a[index] || 0) ^ (b[index] || 0);
  }
  return diff === 0;
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  if (typeof btoa === "function") return btoa(binary);
  return Buffer.from(bytes).toString("base64");
}

function base64ToBytes(value) {
  if (typeof atob === "function") {
    const binary = atob(value);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  }
  return Uint8Array.from(Buffer.from(value, "base64"));
}

function getCookie(request, name) {
  const cookie = request.headers.get("cookie") || "";
  for (const part of cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return "";
}

function buildSessionCookie(token, request) {
  const parts = [
    `${SESSION_COOKIE_NAME}=${token}`,
    "Path=/",
    `Max-Age=${SESSION_TTL_SECONDS}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (new URL(request.url).protocol === "https:") parts.push("Secure");
  return parts.join("; ");
}

function buildExpiredSessionCookie(request) {
  const parts = [`${SESSION_COOKIE_NAME}=`, "Path=/", "Max-Age=0", "HttpOnly", "SameSite=Lax"];
  if (new URL(request.url).protocol === "https:") parts.push("Secure");
  return parts.join("; ");
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

  if (!isValidDateKey(readingDate)) {
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
  const input = isPlainObject(settings) ? settings : {};
  const forecast = sanitizeForecast(input.forecast);
  return {
    ...SETTING_DEFAULTS,
    ...input,
    caiyunApiKey: String(input.caiyunApiKey || ""),
    address: sanitizeAddress(input.address),
    location: sanitizeLocation(input.location),
    electricInitialComplete: Boolean(input.electricInitialComplete),
    gasInitialComplete: Boolean(input.gasInitialComplete),
    electricLastPromptDate: isValidDateKey(input.electricLastPromptDate) ? String(input.electricLastPromptDate) : "",
    gasLastPromptDate: isValidDateKey(input.gasLastPromptDate) ? String(input.gasLastPromptDate) : "",
    forecast,
  };
}

function sanitizeAddress(address) {
  const input = isPlainObject(address) ? address : {};
  return {
    province: String(input.province || "").trim(),
    city: String(input.city || "").trim(),
    district: String(input.district || "").trim(),
    street: String(input.street || "").trim(),
    detail: String(input.detail || "").trim(),
  };
}

function sanitizeLocation(location) {
  if (!isPlainObject(location)) return null;
  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);
  if (!isValidLatitude(latitude) || !isValidLongitude(longitude)) return null;
  return {
    latitude,
    longitude,
    addressText: String(location.addressText || ""),
    provider: String(location.provider || ""),
  };
}

function sanitizeSubmittedLocation(location) {
  if (!isPlainObject(location)) {
    throw new ApiError("请输入有效经纬度", 400);
  }

  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);

  if (!isValidLatitude(latitude)) {
    throw new ApiError("请输入有效纬度（-90 到 90）", 400);
  }

  if (!isValidLongitude(longitude)) {
    throw new ApiError("请输入有效经度（-180 到 180）", 400);
  }

  const provider = String(location.provider || "Manual Coordinates").trim() || "Manual Coordinates";
  return {
    latitude,
    longitude,
    addressText: String(location.addressText || "").trim(),
    provider,
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
    const body = await request.json();
    if (!isPlainObject(body)) {
      throw new ApiError("请求体必须是有效 JSON 对象", 400);
    }
    return body;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("请求体不是有效 JSON", 400);
  }
}

function sanitizeForecast(forecast) {
  const input = isPlainObject(forecast) ? forecast : {};
  const sensitivity = Number(input.sensitivity);
  const baselineDays = Number(input.baselineDays);

  return {
    sensitivity: Number.isFinite(sensitivity) && sensitivity >= 0 && sensitivity <= 20 ? round(sensitivity) : SETTING_DEFAULTS.forecast.sensitivity,
    baselineDays: [7, 14, 30].includes(baselineDays) ? baselineDays : SETTING_DEFAULTS.forecast.baselineDays,
  };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isValidLatitude(value) {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

function isValidLongitude(value) {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}

function isValidDateKey(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return false;
  }

  return date.toISOString().slice(0, 10) === value;
}

function normalizePromptDate(value) {
  if (value === undefined || value === null || value === "") {
    return todayInHongKong();
  }

  const date = String(value);
  if (!isValidDateKey(date)) {
    throw new ApiError("请选择有效日期", 400);
  }

  return date;
}

function jsonResponse(data, status = 200, extraHeaders = {}) {
  const actualStatus = data instanceof ApiError ? data.status : status;
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  for (const [key, value] of Object.entries(extraHeaders)) {
    headers.set(key, value);
  }

  return new Response(JSON.stringify(data), {
    status: actualStatus,
    headers,
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
