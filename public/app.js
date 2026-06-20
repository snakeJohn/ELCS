const METER_META = {
  electric: {
    label: "电表",
    unit: "kWh",
    color: "#138a63",
    icon: "zap",
    currentId: "electricCurrent",
    lastId: "electricLast",
    needleId: "electricNeedle",
    statusId: "electricStatus",
    initialKey: "electricInitialComplete",
    promptKey: "electricLastPromptDate",
  },
  gas: {
    label: "燃气表",
    unit: "m³",
    color: "#9a5a13",
    icon: "flame",
    currentId: "gasCurrent",
    lastId: "gasLast",
    needleId: "gasNeedle",
    statusId: "gasStatus",
    initialKey: "gasInitialComplete",
    promptKey: "gasLastPromptDate",
  },
};

const state = {
  readings: {
    electric: [],
    gas: [],
  },
  settings: null,
  weather: null,
  auth: null,
  chartMeter: "electric",
  startupQueue: [],
  promptQueue: [],
  modalContext: null,
};

const els = {};

document.addEventListener("DOMContentLoaded", async () => {
  cacheElements();
  setDefaultDates();
  bindEvents();
  await initializeAuth();
  refreshIcons();
});

function cacheElements() {
  [
    "addressCity",
    "addressDetail",
    "addressDistrict",
    "addressLabel",
    "addressProvince",
    "addressStreet",
    "appShell",
    "authShell",
    "baselineDays",
    "baselineLabel",
    "caiyunApiKey",
    "changePasswordForm",
    "changePasswordMessage",
    "changePasswordPanel",
    "chartEmpty",
    "confirmPassword",
    "currentPassword",
    "electricCurrent",
    "electricLast",
    "electricNeedle",
    "electricStatus",
    "entryForm",
    "exportButton",
    "forecastGrid",
    "forecastSection",
    "forecastTotal",
    "formMessage",
    "gasCurrent",
    "gasLast",
    "gasNeedle",
    "gasStatus",
    "initialDate",
    "initialForm",
    "initialMessage",
    "initialMeterType",
    "initialValue",
    "insightList",
    "locationMessage",
    "locationLabel",
    "locationProviderLabel",
    "loginForm",
    "loginMessage",
    "loginPanel",
    "loginPassword",
    "loginUsername",
    "logoutButton",
    "manualLatitude",
    "manualLongitude",
    "newPassword",
    "openEntryButton",
    "quickEntryForm",
    "quickFormMessage",
    "quickReadingDate",
    "quickReadingMeterType",
    "quickReadingValue",
    "readingDate",
    "readingMeterType",
    "readingValue",
    "recordsBody",
    "recordsSection",
    "refreshButton",
    "refreshWeatherButton",
    "settingsForm",
    "settingsMessage",
    "settingsSection",
    "sensitivityLabel",
    "startupDate",
    "startupForm",
    "startupMessage",
    "startupMeterType",
    "startupModal",
    "startupSkipButton",
    "startupTitle",
    "startupValue",
    "temperatureSensitivity",
    "toast",
    "useCurrentLocationButton",
    "usageChart",
    "saveManualLocationButton",
    "weatherStatus",
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });

  els.navButtons = [...document.querySelectorAll("[data-section]")];
  els.chartButtons = [...document.querySelectorAll("[data-chart-meter]")];
  els.sections = {
    overview: document.getElementById("overviewSection"),
    records: els.recordsSection,
    forecast: els.forecastSection,
    settings: els.settingsSection,
  };
}

function bindEvents() {
  els.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await login();
  });

  els.changePasswordForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await changePassword();
  });

  els.logoutButton.addEventListener("click", async () => {
    await logout();
  });

  els.openEntryButton.addEventListener("click", () => {
    switchSection("overview");
    els.quickReadingValue.focus();
  });

  els.refreshButton.addEventListener("click", async () => {
    if (await loadState()) {
      render();
      showToast("数据已刷新");
    }
  });

  els.navButtons.forEach((button) => {
    button.addEventListener("click", () => switchSection(button.dataset.section));
  });

  els.chartButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.chartMeter = button.dataset.chartMeter;
      renderChart();
      renderChartButtons();
    });
  });

  els.entryForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const meterType = els.readingMeterType.value;
    await submitReadingForm({
      meterType,
      date: els.readingDate.value,
      value: els.readingValue.value,
      messageEl: els.formMessage,
      clearValue: () => {
        els.readingValue.value = "";
      },
    });
  });

  els.quickEntryForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const meterType = els.quickReadingMeterType.value;
    await submitReadingForm({
      meterType,
      date: els.quickReadingDate.value,
      value: els.quickReadingValue.value,
      messageEl: els.quickFormMessage,
      clearValue: () => {
        els.quickReadingValue.value = "";
      },
    });
  });

  els.initialForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveInitialReading(els.initialMeterType.value, els.initialDate.value, els.initialValue.value, els.initialMessage);
  });

  els.startupForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const context = state.modalContext;
    if (!context) return;

    if (context.mode === "initial") {
      const result = await saveInitialReading(context.meterType, els.startupDate.value, els.startupValue.value, els.startupMessage, false);
      if (result?.ok) {
        closeDialog(els.startupModal);
        maybeShowStartupModal();
      }
      return;
    }

    const result = await api(`/api/readings/${context.meterType}`, {
      method: "POST",
      body: {
        date: els.startupDate.value,
        value: els.startupValue.value,
      },
    });

    if (result.ok) {
      state.readings[context.meterType] = result.data.readings;
      await markPromptShown(context.meterType, els.startupDate.value);
      showFormResult({ ok: true, message: `${METER_META[context.meterType].label}今日读数已保存` }, els.startupMessage);
      closeDialog(els.startupModal);
      render();
      maybeShowDailyPrompt();
    } else {
      showFormResult(result, els.startupMessage);
    }
  });

  els.startupSkipButton.addEventListener("click", async () => {
    const context = state.modalContext;
    if (!context || context.mode !== "daily") return;
    await markPromptShown(context.meterType, todayKey());
    closeDialog(els.startupModal);
    render();
    maybeShowDailyPrompt();
  });

  els.settingsForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const result = await saveSettings();
    if (result.ok) {
      state.settings = result.data.settings;
      const warning = result.data.warning;
      showFormResult(
        {
          ok: true,
          message: warning ? `设置已保存（${warning}）` : "设置已保存",
        },
        els.settingsMessage,
      );
      if (warning) showToast(warning);
      await refreshWeather(false);
      render();
    } else {
      showFormResult(result, els.settingsMessage);
    }
  });

  els.refreshWeatherButton.addEventListener("click", () => refreshWeather(true));
  els.useCurrentLocationButton.addEventListener("click", useCurrentLocation);
  els.saveManualLocationButton.addEventListener("click", saveManualLocation);

  els.recordsBody.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-delete]");
    if (!button || button.disabled) return;
    const meterType = button.dataset.meter;
    const date = button.dataset.delete;
    const confirmed = window.confirm(`删除 ${METER_META[meterType].label} ${formatDate(date)} 的读数？`);
    if (!confirmed) return;

    const result = await api(`/api/readings/${meterType}/${date}`, { method: "DELETE" });
    if (result.ok) {
      state.readings[meterType] = result.data.readings;
      render();
      showToast("记录已删除");
    } else {
      showToast(result.message);
    }
  });

  els.exportButton.addEventListener("click", exportCsv);
  window.addEventListener("resize", debounce(renderChart, 160));
}

function setDefaultDates() {
  const today = todayKey();
  els.readingDate.value = today;
  els.quickReadingDate.value = today;
  els.initialDate.value = today;
  els.startupDate.value = today;
}

async function initializeAuth() {
  const result = await api("/api/auth/status", { skipAuthRedirect: true });
  if (result.ok && result.data.authenticated) {
    state.auth = result.data;
    if (result.data.mustChangePassword) {
      showChangePassword();
      return;
    }
    await showApp();
    return;
  }

  showLogin();
}

async function login() {
  showFormResult({ ok: true, message: "正在登录..." }, els.loginMessage, false);
  const result = await api("/api/auth/login", {
    method: "POST",
    body: {
      username: els.loginUsername.value.trim(),
      password: els.loginPassword.value,
    },
    skipAuthRedirect: true,
  });

  if (!result.ok) {
    showFormResult(result, els.loginMessage, false);
    return;
  }

  state.auth = result.data;
  els.currentPassword.value = "";
  els.newPassword.value = "";
  els.confirmPassword.value = "";

  if (result.data.mustChangePassword) {
    showChangePassword();
    return;
  }

  await showApp();
}

async function changePassword() {
  showFormResult({ ok: true, message: "正在保存..." }, els.changePasswordMessage, false);
  const result = await api("/api/auth/change-password", {
    method: "POST",
    body: {
      currentPassword: els.currentPassword.value,
      newPassword: els.newPassword.value,
      confirmPassword: els.confirmPassword.value,
    },
    skipAuthRedirect: true,
  });

  if (!result.ok) {
    showFormResult(result, els.changePasswordMessage, false);
    return;
  }

  state.auth = result.data;
  els.loginPassword.value = "";
  els.currentPassword.value = "";
  els.newPassword.value = "";
  els.confirmPassword.value = "";
  await showApp();
}

async function logout() {
  await api("/api/auth/logout", { method: "POST", skipAuthRedirect: true });
  state.auth = null;
  state.settings = null;
  state.weather = null;
  state.readings = { electric: [], gas: [] };
  showLogin();
  showToast("已退出登录");
}

async function showApp() {
  els.authShell.classList.add("is-hidden");
  els.appShell.classList.remove("is-hidden");
  const loaded = await loadState();
  if (!loaded) return;
  render();
  maybeShowStartupModal();
}

function showLogin() {
  els.authShell.classList.remove("is-hidden");
  els.loginPanel.classList.remove("is-hidden");
  els.changePasswordPanel.classList.add("is-hidden");
  els.appShell.classList.add("is-hidden");
  els.loginMessage.textContent = "";
  requestAnimationFrame(() => els.loginPassword.focus());
  refreshIcons();
}

function showChangePassword() {
  els.authShell.classList.remove("is-hidden");
  els.loginPanel.classList.add("is-hidden");
  els.changePasswordPanel.classList.remove("is-hidden");
  els.appShell.classList.add("is-hidden");
  els.changePasswordMessage.textContent = "";
  requestAnimationFrame(() => els.currentPassword.focus());
  refreshIcons();
}

async function loadState() {
  const result = await api("/api/state");
  if (!result.ok) {
    showToast(result.message);
    return false;
  }
  state.settings = result.data.settings;
  state.readings = result.data.readings;
  syncSettingsForm();
  return true;
}

async function submitReadingForm({ meterType, date, value, messageEl, clearValue }) {
  const result = await api(`/api/readings/${meterType}`, {
    method: "POST",
    body: { date, value },
  });

  if (result.ok) {
    state.readings[meterType] = result.data.readings;
    if (clearValue) clearValue();
    showFormResult({ ok: true, message: "读数已保存" }, messageEl);
    render();
  } else {
    showFormResult(result, messageEl);
  }

  return result;
}

async function saveInitialReading(meterType, date, value, messageEl, switchAfterSave = true) {
  const result = await api(`/api/readings/${meterType}/initial`, {
    method: "PUT",
    body: { date, value },
  });

  if (result.ok) {
    state.readings[meterType] = result.data.readings;
    state.settings = result.data.settings;
    showFormResult({ ok: true, message: `${METER_META[meterType].label}初始读数已保存` }, messageEl);
    syncSettingsForm();
    render();
    if (switchAfterSave) switchSection("overview");
  } else {
    showFormResult(result, messageEl);
  }

  return result;
}

async function saveSettings() {
  const sensitivity = Number(els.temperatureSensitivity.value);
  const baselineDays = Number(els.baselineDays.value);
  const existingHasKey = Boolean(state.settings?.hasCaiyunApiKey);
  const typedKey = els.caiyunApiKey.value.trim();
  const body = {
    address: readAddressForm(),
    forecast: { sensitivity, baselineDays },
  };

  if (typedKey || !existingHasKey) {
    body.caiyunApiKey = typedKey;
  }

  return api("/api/settings", {
    method: "PUT",
    body,
  });
}

async function refreshWeather(showSuccess) {
  const result = await api("/api/weather");
  if (result.ok) {
    state.weather = result.data.weather;
    if (showSuccess) showToast("天气已更新");
    render();
  } else if (showSuccess) {
    showToast(result.message);
  }
  return result;
}

function syncSettingsForm() {
  const settings = state.settings;
  if (!settings) return;

  const address = settings.address || {};
  els.addressProvince.value = address.province || "";
  els.addressCity.value = address.city || "";
  els.addressDistrict.value = address.district || "";
  els.addressStreet.value = address.street || "";
  els.addressDetail.value = address.detail || "";
  els.caiyunApiKey.value = "";
  els.caiyunApiKey.placeholder = settings.hasCaiyunApiKey ? "已保存，留空则不修改" : "只保存在 Cloudflare D1";
  els.temperatureSensitivity.value = settings.forecast?.sensitivity ?? 2.5;
  els.baselineDays.value = String(settings.forecast?.baselineDays ?? 14);
  els.sensitivityLabel.textContent = `${formatNumber(settings.forecast?.sensitivity ?? 2.5)}% / 摄氏度`;

  const location = settings.location;
  els.manualLatitude.value = location ? location.latitude : "";
  els.manualLongitude.value = location ? location.longitude : "";
}

function readAddressForm() {
  return {
    province: els.addressProvince.value.trim(),
    city: els.addressCity.value.trim(),
    district: els.addressDistrict.value.trim(),
    street: els.addressStreet.value.trim(),
    detail: els.addressDetail.value.trim(),
  };
}

async function useCurrentLocation() {
  if (!navigator.geolocation) {
    showFormResult({ ok: false, message: "当前浏览器不支持定位" }, els.locationMessage);
    return;
  }

  showFormResult({ ok: true, message: "正在请求浏览器定位..." }, els.locationMessage, false);
  try {
    const position = await getBrowserPosition();
    els.manualLatitude.value = position.coords.latitude.toFixed(6);
    els.manualLongitude.value = position.coords.longitude.toFixed(6);
    await saveLocation({
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      provider: "Browser Geolocation",
    });
  } catch (error) {
    showFormResult({ ok: false, message: error.message || "定位失败" }, els.locationMessage);
  }
}

async function saveManualLocation() {
  await saveLocation({
    latitude: els.manualLatitude.value,
    longitude: els.manualLongitude.value,
    provider: "Manual Coordinates",
  });
}

async function saveLocation(location) {
  const addressText = addressToText(readAddressForm()) || addressToText(state.settings?.address || {});
  const result = await api("/api/settings/location", {
    method: "PUT",
    body: {
      ...location,
      addressText,
    },
  });

  if (result.ok) {
    state.settings = result.data.settings;
    syncSettingsForm();
    renderSettingsSummary();
    renderStatus();
    showFormResult({ ok: true, message: "经纬度已保存" }, els.locationMessage);
    await refreshWeather(false);
    render();
  } else {
    showFormResult(result, els.locationMessage);
  }

  return result;
}

function getBrowserPosition() {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 60000,
    });
  });
}

function render() {
  renderMetrics();
  renderInsights();
  renderRecords();
  renderChart();
  renderChartButtons();
  renderForecast();
  renderSettingsSummary();
  renderStatus();
  refreshIcons();
}

function renderMetrics() {
  for (const meterType of Object.keys(METER_META)) {
    const meta = METER_META[meterType];
    const readings = state.readings[meterType] || [];
    const usages = getDailyUsages(meterType);
    const latest = readings.at(-1);
    const lastUsage = usages.at(-1);
    const baseline = getBaselineUsage(meterType);

    els[meta.currentId].textContent = latest ? formatNumber(latest.value) : "--";
    els[meta.lastId].textContent = lastUsage ? formatNumber(lastUsage.usage) : "--";

    const needleAngle = latest ? clamp((lastUsage?.usage || 0) / Math.max(baseline * 2, 1), 0, 1) * 170 - 85 : -85;
    if (els[meta.needleId]) {
      els[meta.needleId].style.transform = `translateX(-50%) rotate(${needleAngle}deg)`;
    }
  }
}

function renderInsights() {
  const items = [];
  for (const meterType of Object.keys(METER_META)) {
    const meta = METER_META[meterType];
    const readings = state.readings[meterType] || [];
    const usages = getDailyUsages(meterType);

    if (!state.settings?.[meta.initialKey]) {
      items.push({
        icon: meta.icon,
        title: `${meta.label}待设置初始读数`,
        text: "设置初始日期和累计读数后，后续每日读数才能计算消耗。",
      });
      continue;
    }

    if (!usages.length) {
      items.push({
        icon: meta.icon,
        title: `${meta.label}等待第二条读数`,
        text: "录入下一次累计读数后即可生成每日消耗。",
      });
      continue;
    }

    const latest = usages.at(-1);
    const recent = usages.slice(-7);
    const avg = average(recent.map((item) => item.usage));
    const peak = usages.reduce((max, item) => (item.usage > max.usage ? item : max), usages[0]);

    items.push({
      icon: meta.icon,
      title: `${meta.label}近 7 日均值 ${formatNumber(avg)} ${meta.unit}/日`,
      text: `最近一次 ${formatDate(latest.date)} 消耗 ${formatNumber(latest.usage)} ${meta.unit}，峰值在 ${formatDate(peak.date)}。`,
    });

    if (readings.length > 2) {
      items.push({
        icon: "calendar-days",
        title: `${meta.label}本月累计 ${formatNumber(getCurrentMonthUsage(meterType))} ${meta.unit}`,
        text: "按相邻两次读数的间隔均摊到每日统计。",
      });
    }
  }

  els.insightList.innerHTML = items
    .map(
      (item) => `
        <div class="insight-item">
          <span class="insight-icon"><i data-lucide="${item.icon}"></i></span>
          <div>
            <strong>${escapeHtml(item.title)}</strong>
            <span>${escapeHtml(item.text)}</span>
          </div>
        </div>
      `,
    )
    .join("");
}

function renderRecords() {
  const rows = Object.keys(METER_META)
    .flatMap((meterType) => {
      const meta = METER_META[meterType];
      const usageByDate = new Map(getDailyUsages(meterType).map((item) => [item.date, item.usage]));
      return (state.readings[meterType] || []).map((record) => ({
        ...record,
        meterType,
        meta,
        usage: usageByDate.get(record.date),
      }));
    })
    .sort((a, b) => b.date.localeCompare(a.date) || a.meterType.localeCompare(b.meterType))
    .map((record) => {
      const badgeClass = record.meterType === "gas" ? "badge gas" : "badge";
      return `
        <tr>
          <td><span class="${badgeClass}">${record.meta.label}</span></td>
          <td>${formatDate(record.date)}${record.isInitial ? " · 初始" : ""}</td>
          <td>${formatNumber(record.value)} ${record.meta.unit}</td>
          <td>${record.usage === undefined ? "--" : `${formatNumber(record.usage)} ${record.meta.unit}`}</td>
          <td>
            <button class="table-action" data-meter="${record.meterType}" data-delete="${record.date}" type="button" aria-label="删除 ${record.meta.label} ${formatDate(record.date)}" ${record.isInitial ? "disabled" : ""}>
              <i data-lucide="${record.isInitial ? "lock" : "trash-2"}"></i>
            </button>
          </td>
        </tr>
      `;
    })
    .join("");

  els.recordsBody.innerHTML =
    rows ||
    `<tr>
      <td colspan="5">暂无读数记录</td>
    </tr>`;
}

function renderChart() {
  const canvas = els.usageChart;
  const ctx = canvas.getContext("2d");
  const meta = METER_META[state.chartMeter];
  const dailyUsages = getDailyUsages(state.chartMeter).slice(-30);
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();

  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);

  if (!dailyUsages.length) {
    els.chartEmpty.classList.add("is-visible");
    return;
  }

  els.chartEmpty.classList.remove("is-visible");

  const width = rect.width;
  const height = rect.height;
  const pad = { top: 22, right: 24, bottom: 42, left: 48 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const values = dailyUsages.map((item) => item.usage);
  const max = Math.max(...values, 1);
  const upper = Math.ceil(max * 1.18);
  const xStep = plotWidth / Math.max(dailyUsages.length - 1, 1);

  ctx.lineWidth = 1;
  ctx.strokeStyle = "#dbe4ec";
  ctx.fillStyle = "#647280";
  ctx.font = "12px Microsoft YaHei, Arial";

  for (let i = 0; i <= 4; i += 1) {
    const y = pad.top + (plotHeight / 4) * i;
    const label = upper - (upper / 4) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
    ctx.fillText(formatNumber(label), 8, y + 4);
  }

  const points = dailyUsages.map((item, index) => {
    const x = pad.left + index * xStep;
    const y = pad.top + plotHeight - (item.usage / upper) * plotHeight;
    return { ...item, x, y };
  });

  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.lineTo(points.at(-1).x, pad.top + plotHeight);
  ctx.lineTo(points[0].x, pad.top + plotHeight);
  ctx.closePath();

  const gradient = ctx.createLinearGradient(0, pad.top, 0, pad.top + plotHeight);
  gradient.addColorStop(0, `${meta.color}33`);
  gradient.addColorStop(1, `${meta.color}05`);
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.lineWidth = 3;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = meta.color;
  ctx.stroke();

  points.forEach((point) => {
    ctx.beginPath();
    ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = meta.color;
    ctx.stroke();
  });

  ctx.fillStyle = "#647280";
  pickLabelIndexes(points.length).forEach((index) => {
    const point = points[index];
    ctx.fillText(shortDate(point.date), Math.max(4, point.x - 18), height - 14);
  });
}

function renderChartButtons() {
  els.chartButtons.forEach((button) => {
    button.classList.toggle("is-selected", button.dataset.chartMeter === state.chartMeter);
  });
}

function renderForecast() {
  const baseline = getBaselineUsage("electric");

  if (!state.weather?.daily?.length) {
    els.forecastGrid.innerHTML = placeholderForecast(state.settings?.hasCaiyunApiKey ? "点击更新天气" : "请先填写彩云 API 密钥");
    els.forecastTotal.textContent = "--";
    return;
  }

  const sensitivity = Number(state.settings?.forecast?.sensitivity || 2.5);
  const forecasts = state.weather.daily.map((day) => {
    const temperature = Number(day.temperatureMax);
    const delta = Math.max(0, temperature - 26);
    const usage = baseline * (1 + (delta * sensitivity) / 100);
    return { ...day, usage: round(usage), delta };
  });

  els.forecastTotal.textContent = formatNumber(sum(forecasts.map((item) => item.usage)));
  els.forecastGrid.innerHTML = forecasts
    .map(
      (item) => `
        <article class="forecast-card">
          <time>${shortWeekday(item.date)}</time>
          <span class="forecast-icon"><i data-lucide="${weatherIcon(item.weatherCode)}"></i></span>
          <strong>${formatNumber(item.usage)} kWh</strong>
          <span>${formatNumber(item.temperatureMin)}-${formatNumber(item.temperatureMax)}°C</span>
          <small>${item.delta > 0 ? `高温增量 +${formatNumber(item.usage - baseline)}` : "按基准估算"}</small>
        </article>
      `,
    )
    .join("");
}

function renderSettingsSummary() {
  const address = state.settings?.address || {};
  const location = state.settings?.location;
  els.addressLabel.textContent = addressToText(address) || "未填写";
  els.locationLabel.textContent = location ? `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}` : "未获取";
  els.locationProviderLabel.textContent = location?.provider || "--";
  els.baselineLabel.textContent = `${formatNumber(getBaselineUsage("electric"))} kWh / 日`;
  els.sensitivityLabel.textContent = `${formatNumber(state.settings?.forecast?.sensitivity ?? 2.5)}% / 摄氏度`;
}

function renderStatus() {
  const today = todayKey();
  for (const meterType of Object.keys(METER_META)) {
    const meta = METER_META[meterType];
    const el = els[meta.statusId];
    const hasInitial = Boolean(state.settings?.[meta.initialKey]);
    const hasToday = (state.readings[meterType] || []).some((record) => record.date === today);
    el.classList.toggle("is-good", hasInitial && hasToday);
    el.classList.toggle("is-warn", !hasInitial || !hasToday);
    el.querySelector("span").textContent = !hasInitial ? `${meta.label}待初始化` : hasToday ? `${meta.label}今日已录入` : `${meta.label}今日待录入`;
  }

  const hasWeather = Boolean(state.weather?.daily?.length);
  els.weatherStatus.classList.toggle("is-good", hasWeather);
  els.weatherStatus.classList.toggle("is-warn", !hasWeather);
  if (!state.settings?.hasCaiyunApiKey) {
    els.weatherStatus.querySelector("span").textContent = "待填彩云密钥";
  } else if (!state.settings?.location) {
    els.weatherStatus.querySelector("span").textContent = "待获取经纬度";
  } else if (hasWeather) {
    const todayWeather = state.weather.daily[0];
    els.weatherStatus.querySelector("span").textContent = `${formatNumber(todayWeather.temperatureMin)}-${formatNumber(todayWeather.temperatureMax)}°C`;
  } else {
    els.weatherStatus.querySelector("span").textContent = "等待天气更新";
  }
}

function maybeShowStartupModal() {
  state.startupQueue = Object.keys(METER_META).filter((meterType) => !state.settings?.[METER_META[meterType].initialKey]);
  const next = state.startupQueue[0];
  if (!next) {
    maybeShowDailyPrompt();
    return;
  }

  showMeterModal("initial", next);
}

function maybeShowDailyPrompt() {
  const today = todayKey();
  state.promptQueue = Object.keys(METER_META).filter((meterType) => {
    const meta = METER_META[meterType];
    const hasInitial = Boolean(state.settings?.[meta.initialKey]);
    const hasToday = (state.readings[meterType] || []).some((record) => record.date === today);
    const promptedToday = state.settings?.[meta.promptKey] === today;
    return hasInitial && !hasToday && !promptedToday;
  });

  const next = state.promptQueue[0];
  if (!next) return;
  showMeterModal("daily", next);
}

function showMeterModal(mode, meterType) {
  const meta = METER_META[meterType];
  state.modalContext = { mode, meterType };
  els.startupMeterType.value = meterType;
  els.startupMeterType.disabled = true;
  els.startupTitle.textContent = mode === "initial" ? `设置${meta.label}初始读数` : `录入今日${meta.label}读数`;
  els.startupDate.value = todayKey();
  els.startupValue.value = "";
  els.startupMessage.textContent = "";
  els.startupSkipButton.style.display = mode === "daily" ? "inline-flex" : "none";
  openDialog(els.startupModal);
  els.startupValue.focus();
}

async function markPromptShown(meterType, date) {
  const result = await api("/api/prompt", {
    method: "POST",
    body: { meterType, date },
  });
  if (result.ok) {
    state.settings = result.data.settings;
  }
}

function switchSection(section) {
  Object.entries(els.sections).forEach(([key, element]) => {
    element.classList.toggle("is-visible", key === section);
  });
  els.navButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.section === section);
  });
  requestAnimationFrame(renderChart);
}

function getDailyUsages(meterType) {
  const readings = state.readings[meterType] || [];
  const usages = [];

  for (let index = 1; index < readings.length; index += 1) {
    const previous = readings[index - 1];
    const current = readings[index];
    const dayGap = Math.max(1, daysBetween(previous.date, current.date));
    const totalUsage = round(current.value - previous.value);
    const perDay = round(totalUsage / dayGap);

    for (let offset = 1; offset <= dayGap; offset += 1) {
      usages.push({
        date: addDays(previous.date, offset),
        usage: perDay,
        estimated: dayGap > 1,
      });
    }
  }

  return usages;
}

function getBaselineUsage(meterType) {
  const days = Number(state.settings?.forecast?.baselineDays || 14);
  const usages = getDailyUsages(meterType).slice(-days);
  if (usages.length) {
    return round(average(usages.map((item) => item.usage)));
  }
  return meterType === "electric" ? 8 : 1.2;
}

function getCurrentMonthUsage(meterType) {
  const currentMonth = todayKey().slice(0, 7);
  const usages = getDailyUsages(meterType).filter((item) => item.date.startsWith(currentMonth));
  return round(sum(usages.map((item) => item.usage)));
}

async function api(path, options = {}) {
  try {
    const response = await fetch(path, {
      method: options.method || "GET",
      credentials: "same-origin",
      headers: options.body ? { "content-type": "application/json" } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const data = await response.json();
    if (!response.ok) {
      if (!options.skipAuthRedirect) {
        if (response.status === 401) showLogin();
        if (response.status === 403 && data.code === "PASSWORD_CHANGE_REQUIRED") showChangePassword();
      }
      return { ok: false, message: data.error || "请求失败", data };
    }
    return { ok: true, data };
  } catch (error) {
    return { ok: false, message: error.message || "网络请求失败", data: null };
  }
}

function showFormResult(result, element, toastOnSuccess = true) {
  element.textContent = result.message;
  element.classList.toggle("is-error", !result.ok);
  if (result.ok && toastOnSuccess) showToast(result.message);
}

function exportCsv() {
  const lines = [["meter_type", "date", "reading", "daily_usage", "unit", "is_initial"]];
  for (const meterType of Object.keys(METER_META)) {
    const meta = METER_META[meterType];
    const usageByDate = new Map(getDailyUsages(meterType).map((item) => [item.date, item.usage]));
    (state.readings[meterType] || []).forEach((record) => {
      lines.push([meterType, record.date, record.value, usageByDate.get(record.date) ?? "", meta.unit, record.isInitial ? "1" : "0"]);
    });
  }

  const csv = lines.map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `能耗读数-${todayKey()}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
  showToast("CSV 已导出");
}

function csvCell(value) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function placeholderForecast(text) {
  return Array.from({ length: 7 })
    .map(
      (_, index) => `
        <article class="forecast-card">
          <time>${index === 0 ? "今天" : `第 ${index + 1} 天`}</time>
          <span class="forecast-icon"><i data-lucide="cloud-sun"></i></span>
          <strong>--</strong>
          <span>${escapeHtml(text)}</span>
          <small>等待数据</small>
        </article>
      `,
    )
    .join("");
}

function weatherIcon(code) {
  const value = String(code);
  if (["CLEAR_DAY", "CLEAR_NIGHT"].includes(value)) return "sun";
  if (["PARTLY_CLOUDY_DAY", "PARTLY_CLOUDY_NIGHT"].includes(value)) return "cloud-sun";
  if (value.includes("RAIN")) return "cloud-rain";
  if (value.includes("SNOW")) return "cloud-snow";
  if (value.includes("WIND")) return "wind";
  if (value.includes("FOG") || value.includes("HAZE")) return "cloud-fog";
  if (value.includes("CLOUDY") || value.includes("OVERCAST")) return "cloud";
  return "cloud-sun";
}

function openDialog(dialog) {
  if (typeof dialog.showModal === "function") dialog.showModal();
  refreshIcons();
}

function closeDialog(dialog) {
  if (dialog.open) dialog.close();
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("is-visible");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.remove("is-visible"), 2800);
}

function refreshIcons() {
  if (window.lucide) window.lucide.createIcons();
}

function addressToText(address) {
  return [address.province, address.city, address.district, address.street, address.detail].filter(Boolean).join("");
}

function pickLabelIndexes(length) {
  if (length <= 1) return [0];
  const maxLabels = 6;
  const step = Math.max(1, Math.ceil((length - 1) / (maxLabels - 1)));
  const indexes = [];
  for (let index = 0; index < length; index += step) indexes.push(index);
  if (!indexes.includes(length - 1)) indexes.push(length - 1);
  return indexes;
}

function todayKey() {
  const date = new Date();
  const timezoneOffset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 10);
}

function addDays(dateString, amount) {
  const date = new Date(`${dateString}T00:00:00`);
  date.setDate(date.getDate() + amount);
  return toDateInputValue(date);
}

function daysBetween(start, end) {
  const a = new Date(`${start}T00:00:00`);
  const b = new Date(`${end}T00:00:00`);
  return Math.round((b - a) / 86400000);
}

function toDateInputValue(date) {
  const timezoneOffset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 10);
}

function formatDate(dateString) {
  if (!dateString) return "--";
  const date = new Date(`${dateString}T00:00:00`);
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(date);
}

function shortDate(dateString) {
  return formatDate(dateString).replace("/", ".");
}

function shortWeekday(dateString) {
  const date = new Date(`${dateString}T00:00:00`);
  const formatted = new Intl.DateTimeFormat("zh-CN", {
    weekday: "short",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  return formatted.replace(/\//g, ".");
}

function formatNumber(value) {
  if (!Number.isFinite(Number(value))) return "--";
  return new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(Number(value));
}

function average(values) {
  if (!values.length) return 0;
  return sum(values) / values.length;
}

function sum(values) {
  return values.reduce((total, value) => total + Number(value || 0), 0);
}

function round(value) {
  return Math.round(Number(value) * 100) / 100;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
