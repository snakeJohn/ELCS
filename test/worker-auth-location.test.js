import test from "node:test";
import assert from "node:assert/strict";

import worker from "../src/worker.js";

class MemoryD1 {
  constructor() {
    this.settings = new Map();
    this.readings = [];
  }

  prepare(sql) {
    return new MemoryStatement(this, sql);
  }

  async batch(statements) {
    return Promise.all(statements.map((statement) => statement.run()));
  }
}

class MemoryStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.params = [];
  }

  bind(...params) {
    this.params = params;
    return this;
  }

  async first() {
    if (/SELECT value FROM settings WHERE key = 'app'/.test(this.sql)) {
      const value = this.db.settings.get("app");
      return value ? { value } : null;
    }

    if (/SELECT value FROM settings WHERE key = 'auth'/.test(this.sql)) {
      const value = this.db.settings.get("auth");
      return value ? { value } : null;
    }

    if (/SELECT is_initial FROM readings/.test(this.sql)) {
      const [meterType, readingDate] = this.params;
      const row = this.db.readings.find((item) => item.meterType === meterType && item.date === readingDate);
      return row ? { is_initial: row.isInitial ? 1 : 0 } : null;
    }

    if (/FROM readings/.test(this.sql)) {
      return null;
    }

    throw new Error(`Unsupported first query: ${this.sql}`);
  }

  async all() {
    if (/FROM readings/.test(this.sql)) {
      const [meterType] = this.params;
      const results = this.db.readings
        .filter((item) => item.meterType === meterType)
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((item) => ({
          meterType: item.meterType,
          date: item.date,
          value: item.value,
          isInitial: item.isInitial ? 1 : 0,
          createdAt: item.createdAt || "2026-06-20T00:00:00.000Z",
          updatedAt: item.updatedAt || "2026-06-20T00:00:00.000Z",
        }));
      return { results };
    }

    throw new Error(`Unsupported all query: ${this.sql}`);
  }

  async run() {
    if (/VALUES \('app', \?1/.test(this.sql)) {
      this.db.settings.set("app", this.params[0]);
      return { success: true };
    }

    if (/VALUES \('auth', \?1/.test(this.sql)) {
      this.db.settings.set("auth", this.params[0]);
      return { success: true };
    }

    if (/INSERT INTO readings/.test(this.sql)) {
      return { success: true };
    }

    if (/DELETE FROM readings/.test(this.sql)) {
      return { success: true };
    }

    throw new Error(`Unsupported run query: ${this.sql}`);
  }
}

function createEnv(db = new MemoryD1()) {
  return {
    DB: db,
    ASSETS: {
      fetch: async () => new Response("<!doctype html><title>asset</title>", { headers: { "content-type": "text/html" } }),
    },
  };
}

async function api(env, path, options = {}) {
  const hasBody = Object.prototype.hasOwnProperty.call(options, "body");
  const request = new Request(`https://example.test${path}`, {
    method: options.method || "GET",
    headers: {
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...(hasBody ? { "content-type": "application/json" } : {}),
    },
    body: hasBody ? JSON.stringify(options.body) : undefined,
  });
  const response = await worker.fetch(request, env);
  const data = await response.json();
  return { response, data, cookie: response.headers.get("set-cookie") };
}

function sessionCookie(setCookie) {
  return String(setCookie).split(";")[0];
}

async function authenticatedCookie(env, password = "SafePass123") {
  const login = await api(env, "/api/auth/login", {
    method: "POST",
    body: { username: "admin", password: "password" },
  });
  const changed = await api(env, "/api/auth/change-password", {
    method: "POST",
    cookie: sessionCookie(login.cookie),
    body: { currentPassword: "password", newPassword: password, confirmPassword: password },
  });
  return sessionCookie(changed.cookie);
}

test("business APIs require authentication", async () => {
  const env = createEnv();

  const { response, data } = await api(env, "/api/state");

  assert.equal(response.status, 401);
  assert.match(data.error, /登录/);
});

test("default admin login creates a forced password-change session", async () => {
  const env = createEnv();

  const login = await api(env, "/api/auth/login", {
    method: "POST",
    body: { username: "admin", password: "password" },
  });

  assert.equal(login.response.status, 200);
  assert.equal(login.data.authenticated, true);
  assert.equal(login.data.mustChangePassword, true);
  assert.match(login.cookie, /elcs_session=/);

  const blocked = await api(env, "/api/state", { cookie: sessionCookie(login.cookie) });
  assert.equal(blocked.response.status, 403);
  assert.equal(blocked.data.code, "PASSWORD_CHANGE_REQUIRED");
});

test("password change unlocks the app and invalidates the default password", async () => {
  const env = createEnv();

  const firstLogin = await api(env, "/api/auth/login", {
    method: "POST",
    body: { username: "admin", password: "password" },
  });
  const firstCookie = sessionCookie(firstLogin.cookie);

  const rejected = await api(env, "/api/auth/change-password", {
    method: "POST",
    cookie: firstCookie,
    body: { currentPassword: "wrong", newPassword: "NewPassword123", confirmPassword: "NewPassword123" },
  });
  assert.equal(rejected.response.status, 401);

  const changed = await api(env, "/api/auth/change-password", {
    method: "POST",
    cookie: firstCookie,
    body: { currentPassword: "password", newPassword: "NewPassword123", confirmPassword: "NewPassword123" },
  });
  assert.equal(changed.response.status, 200);
  assert.equal(changed.data.mustChangePassword, false);
  const changedCookie = sessionCookie(changed.cookie);

  const state = await api(env, "/api/state", { cookie: changedCookie });
  assert.equal(state.response.status, 200);
  assert.deepEqual(state.data.readings, { electric: [], gas: [] });

  const oldLogin = await api(env, "/api/auth/login", {
    method: "POST",
    body: { username: "admin", password: "password" },
  });
  assert.equal(oldLogin.response.status, 401);

  const newLogin = await api(env, "/api/auth/login", {
    method: "POST",
    body: { username: "admin", password: "NewPassword123" },
  });
  assert.equal(newLogin.response.status, 200);
  assert.equal(newLogin.data.mustChangePassword, false);
});

test("authenticated users can save manual coordinates", async () => {
  const env = createEnv();

  const cookie = await authenticatedCookie(env, "LocationPass123");

  const saved = await api(env, "/api/settings/location", {
    method: "PUT",
    cookie,
    body: {
      latitude: 22.6849,
      longitude: 113.9426,
      addressText: "广东省深圳市宝安区石岩街道新风路10号",
      provider: "Manual Coordinates",
    },
  });

  assert.equal(saved.response.status, 200);
  assert.equal(saved.data.settings.location.latitude, 22.6849);
  assert.equal(saved.data.settings.location.longitude, 113.9426);
  assert.equal(saved.data.settings.location.provider, "Manual Coordinates");

  const invalid = await api(env, "/api/settings/location", {
    method: "PUT",
    cookie,
    body: { latitude: 120, longitude: 113.9426 },
  });
  assert.equal(invalid.response.status, 400);
});

test("invalid JSON shapes are rejected as client errors", async () => {
  const env = createEnv();
  const cookie = await authenticatedCookie(env);

  const saved = await api(env, "/api/settings", {
    method: "PUT",
    cookie,
    body: null,
  });

  assert.equal(saved.response.status, 400);
  assert.match(saved.data.error, /JSON/);
});

test("readings reject impossible calendar dates", async () => {
  const env = createEnv();
  const cookie = await authenticatedCookie(env);

  const saved = await api(env, "/api/readings/electric", {
    method: "POST",
    cookie,
    body: { date: "2026-02-31", value: 100 },
  });

  assert.equal(saved.response.status, 400);
  assert.match(saved.data.error, /日期/);
});

test("regular reading endpoint cannot create or overwrite initial readings", async () => {
  const env = createEnv();
  const cookie = await authenticatedCookie(env);

  const forgedInitial = await api(env, "/api/readings/electric", {
    method: "POST",
    cookie,
    body: { date: "2026-06-20", value: 100, isInitial: true },
  });

  assert.equal(forgedInitial.response.status, 400);
  assert.match(forgedInitial.data.error, /初始读数/);

  env.DB.readings.push({
    meterType: "electric",
    date: "2026-06-20",
    value: 100,
    isInitial: true,
  });

  const overwrittenInitial = await api(env, "/api/readings/electric", {
    method: "POST",
    cookie,
    body: { date: "2026-06-20", value: 120 },
  });

  assert.equal(overwrittenInitial.response.status, 400);
  assert.match(overwrittenInitial.data.error, /初始读数/);
});

test("settings normalize out-of-range forecast values", async () => {
  const env = createEnv();
  const cookie = await authenticatedCookie(env);

  const saved = await api(env, "/api/settings", {
    method: "PUT",
    cookie,
    body: {
      forecast: {
        sensitivity: "not-a-number",
        baselineDays: 0,
      },
    },
  });

  assert.equal(saved.response.status, 200);
  assert.equal(saved.data.settings.forecast.sensitivity, 2.5);
  assert.equal(saved.data.settings.forecast.baselineDays, 14);
});

test("corrupt auth state does not re-enable the default password", async () => {
  const env = createEnv();
  env.DB.settings.set("auth", "{not-json");

  const login = await api(env, "/api/auth/login", {
    method: "POST",
    body: { username: "admin", password: "password" },
  });

  assert.equal(login.response.status, 500);
  assert.equal(login.cookie, null);
  assert.match(login.data.error, /认证/);
});
