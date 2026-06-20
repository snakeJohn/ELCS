# iOS 27 UI Worker Deploy Implementation Plan

> Note: The D1 deployment guard work in this historical implementation plan has been superseded. The current repository uses Cloudflare Dashboard D1 binding and does not store `database_id` in `wrangler.toml`. Use `README.md` and `DEPLOY.md` for current deployment steps.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the meter dashboard into the approved iOS 27 / Liquid Glass Productivity Console, add focused tests, and guard Cloudflare Worker deployment from placeholder D1 configuration.

**Architecture:** Keep the current Cloudflare Worker API and D1 schema. Refactor front-end pure calculations into `public/domain.js`, keep DOM rendering in `public/app.js`, serve all runtime assets from `public/`, and gate real remote deploy commands through a Node config check.

**Tech Stack:** Cloudflare Worker, Workers Static Assets, D1, native HTML/CSS/JavaScript modules, Node `node:test`, Wrangler `4.103.0`, local static lucide UMD bundle pinned to `lucide@1.21.0`.

---

## Git Note

This workspace is not a git repository. `git status` currently returns `fatal: not a git repository (or any of the parent directories): .git`. The commit steps required by the generic Superpowers plan format are replaced by checkpoint notes and fresh verification commands.

## File Structure

- Create `public/domain.js`: pure front-end business logic shared by browser and Node tests.
- Create `test/domain.test.js`: behavior tests for usage interpolation, baselines, month totals, and CSV escaping.
- Create `scripts/check-deploy-config.js`: CLI and exported helpers for validating `wrangler.toml`.
- Create `test/check-deploy-config.test.js`: behavior tests for deploy config validation.
- Create `test/static-assets.test.js`: static checks for local icon asset usage, package scripts, and required UI selectors/classes.
- Create `public/vendor/lucide.min.js`: local pinned lucide UMD runtime copied from `lucide@1.21.0`.
- Modify `package.json`: add test, deploy dry-run, deploy guard scripts, and guarded remote migration.
- Modify `public/index.html`: Balanced Console structure and module script loading.
- Modify `public/styles.css`: Liquid Glass visual system and responsive layout.
- Modify `public/app.js`: import domain helpers, bind the new DOM, render the new UI, and keep existing API behavior.
- Leave `src/worker.js`, `migrations/0001_initial.sql`, and `wrangler.toml` behaviorally unchanged unless verification exposes a defect.

---

### Task 1: Extract And Test Domain Logic

**Files:**
- Create: `public/domain.js`
- Create: `test/domain.test.js`

- [ ] **Step 1: Write failing domain tests**

Create `test/domain.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";

import {
  addDays,
  csvCell,
  daysBetween,
  getBaselineUsage,
  getCurrentMonthUsage,
  getDailyUsages,
  round,
} from "../public/domain.js";

test("getDailyUsages returns one row for adjacent cumulative readings", () => {
  const usages = getDailyUsages([
    { date: "2026-06-01", value: 100 },
    { date: "2026-06-02", value: 108.25 },
  ]);

  assert.deepEqual(usages, [{ date: "2026-06-02", usage: 8.25, estimated: false }]);
});

test("getDailyUsages evenly distributes multi-day gaps", () => {
  const usages = getDailyUsages([
    { date: "2026-06-01", value: 100 },
    { date: "2026-06-04", value: 106 },
  ]);

  assert.deepEqual(usages, [
    { date: "2026-06-02", usage: 2, estimated: true },
    { date: "2026-06-03", usage: 2, estimated: true },
    { date: "2026-06-04", usage: 2, estimated: true },
  ]);
});

test("getDailyUsages sorts readings by date before calculating", () => {
  const usages = getDailyUsages([
    { date: "2026-06-03", value: 116 },
    { date: "2026-06-01", value: 100 },
    { date: "2026-06-02", value: 108 },
  ]);

  assert.deepEqual(usages, [
    { date: "2026-06-02", usage: 8, estimated: false },
    { date: "2026-06-03", usage: 8, estimated: false },
  ]);
});

test("getBaselineUsage uses the latest N usage rows", () => {
  const readings = [
    { date: "2026-06-01", value: 100 },
    { date: "2026-06-02", value: 110 },
    { date: "2026-06-03", value: 118 },
    { date: "2026-06-04", value: 124 },
  ];

  assert.equal(getBaselineUsage(readings, { baselineDays: 2, fallback: 8 }), 7);
});

test("getBaselineUsage falls back when no usage rows exist", () => {
  assert.equal(getBaselineUsage([], { baselineDays: 14, fallback: 1.2 }), 1.2);
});

test("getCurrentMonthUsage counts only the month containing today", () => {
  const readings = [
    { date: "2026-05-31", value: 100 },
    { date: "2026-06-01", value: 108 },
    { date: "2026-06-02", value: 116 },
  ];

  assert.equal(getCurrentMonthUsage(readings, "2026-06-20"), 16);
});

test("csvCell escapes commas quotes and newlines", () => {
  assert.equal(csvCell("plain"), "plain");
  assert.equal(csvCell("a,b"), "\"a,b\"");
  assert.equal(csvCell("a\"b"), "\"a\"\"b\"");
  assert.equal(csvCell("a\nb"), "\"a\nb\"");
});

test("date helpers produce stable day math", () => {
  assert.equal(daysBetween("2026-06-01", "2026-06-04"), 3);
  assert.equal(addDays("2026-06-01", 3), "2026-06-04");
});

test("round keeps two decimal places", () => {
  assert.equal(round(1.235), 1.24);
  assert.equal(round("8.001"), 8);
});
```

- [ ] **Step 2: Run domain tests to verify RED**

Run:

```powershell
node --test test/domain.test.js
```

Expected: FAIL because `public/domain.js` does not exist yet.

- [ ] **Step 3: Implement pure domain helpers**

Create `public/domain.js`:

```js
export const METER_META = {
  electric: {
    label: "电表",
    unit: "kWh",
    color: "#15896f",
    icon: "zap",
    defaultBaseline: 8,
    initialKey: "electricInitialComplete",
    promptKey: "electricLastPromptDate",
  },
  gas: {
    label: "燃气表",
    unit: "m³",
    color: "#a66a2c",
    icon: "flame",
    defaultBaseline: 1.2,
    initialKey: "gasInitialComplete",
    promptKey: "gasLastPromptDate",
  },
};

export function getDailyUsages(readings) {
  const ordered = [...(readings || [])]
    .filter((reading) => reading?.date && Number.isFinite(Number(reading.value)))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const usages = [];

  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    const dayGap = Math.max(1, daysBetween(previous.date, current.date));
    const totalUsage = round(Number(current.value) - Number(previous.value));
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

export function getBaselineUsage(readings, options = {}) {
  const baselineDays = Number(options.baselineDays || 14);
  const fallback = Number(options.fallback || 0);
  const usages = getDailyUsages(readings).slice(-baselineDays);
  if (!usages.length) return fallback;
  return round(average(usages.map((item) => item.usage)));
}

export function getCurrentMonthUsage(readings, today) {
  const currentMonth = String(today).slice(0, 7);
  const usages = getDailyUsages(readings).filter((item) => item.date.startsWith(currentMonth));
  return round(sum(usages.map((item) => item.usage)));
}

export function csvCell(value) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function addDays(dateString, amount) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + Number(amount));
  return toDateInputValue(date);
}

export function daysBetween(start, end) {
  const a = new Date(`${start}T00:00:00Z`);
  const b = new Date(`${end}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

export function toDateInputValue(date) {
  return new Date(date).toISOString().slice(0, 10);
}

export function average(values) {
  if (!values.length) return 0;
  return sum(values) / values.length;
}

export function sum(values) {
  return values.reduce((total, value) => total + Number(value || 0), 0);
}

export function round(value) {
  return Math.round(Number(value) * 100) / 100;
}
```

- [ ] **Step 4: Run domain tests to verify GREEN**

Run:

```powershell
node --test test/domain.test.js
```

Expected: PASS.

- [ ] **Step 5: Checkpoint**

Run:

```powershell
git status --short
```

Expected in this workspace: `fatal: not a git repository (or any of the parent directories): .git`.

---

### Task 2: Add Deploy Guard With Tests

**Files:**
- Create: `scripts/check-deploy-config.js`
- Create: `test/check-deploy-config.test.js`

- [ ] **Step 1: Write failing deploy guard tests**

Create `test/check-deploy-config.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";

import { readDatabaseId, validateWranglerToml } from "../scripts/check-deploy-config.js";

test("readDatabaseId extracts a configured D1 database id", () => {
  const toml = `
name = "meter-usage-dashboard"

[[d1_databases]]
binding = "DB"
database_name = "meter-usage"
database_id = "11111111-2222-3333-4444-555555555555"
`;

  assert.equal(readDatabaseId(toml), "11111111-2222-3333-4444-555555555555");
});

test("validateWranglerToml rejects the placeholder database id", () => {
  const result = validateWranglerToml('database_id = "replace-with-your-d1-database-id"');

  assert.equal(result.ok, false);
  assert.match(result.message, /replace-with-your-d1-database-id/);
  assert.match(result.message, /wrangler d1 create meter-usage/);
});

test("validateWranglerToml rejects a missing database id", () => {
  const result = validateWranglerToml('name = "meter-usage-dashboard"');

  assert.equal(result.ok, false);
  assert.match(result.message, /database_id/);
});

test("validateWranglerToml accepts a non-placeholder database id", () => {
  const result = validateWranglerToml('database_id = "11111111-2222-3333-4444-555555555555"');

  assert.deepEqual(result, { ok: true, databaseId: "11111111-2222-3333-4444-555555555555" });
});
```

- [ ] **Step 2: Run deploy guard tests to verify RED**

Run:

```powershell
node --test test/check-deploy-config.test.js
```

Expected: FAIL because `scripts/check-deploy-config.js` does not exist yet.

- [ ] **Step 3: Implement deploy config guard**

Create `scripts/check-deploy-config.js`:

```js
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PLACEHOLDER_DATABASE_ID = "replace-with-your-d1-database-id";

export function readDatabaseId(tomlText) {
  const match = String(tomlText).match(/^\s*database_id\s*=\s*"([^"]*)"\s*$/m);
  return match ? match[1].trim() : "";
}

export function validateWranglerToml(tomlText) {
  const databaseId = readDatabaseId(tomlText);

  if (!databaseId) {
    return {
      ok: false,
      message:
        'wrangler.toml is missing database_id. Run "npx wrangler d1 create meter-usage" and copy the generated database_id into wrangler.toml.',
    };
  }

  if (databaseId === PLACEHOLDER_DATABASE_ID) {
    return {
      ok: false,
      message:
        'wrangler.toml still uses database_id = "replace-with-your-d1-database-id". Run "npx wrangler d1 create meter-usage" and replace it before remote migration or deploy.',
    };
  }

  return { ok: true, databaseId };
}

export function checkDeployConfig(filePath = "wrangler.toml") {
  const tomlText = readFileSync(filePath, "utf8");
  return validateWranglerToml(tomlText);
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const result = checkDeployConfig(process.argv[2] || "wrangler.toml");
  if (!result.ok) {
    console.error(result.message);
    process.exit(1);
  }

  console.log(`Cloudflare D1 database_id configured: ${result.databaseId}`);
}
```

- [ ] **Step 4: Run deploy guard tests to verify GREEN**

Run:

```powershell
node --test test/check-deploy-config.test.js
```

Expected: PASS.

- [ ] **Step 5: Verify CLI failure with current placeholder**

Run:

```powershell
node scripts/check-deploy-config.js
```

Expected: exit code `1` with a message mentioning `replace-with-your-d1-database-id` and `npx wrangler d1 create meter-usage`.

- [ ] **Step 6: Checkpoint**

Run:

```powershell
git status --short
```

Expected in this workspace: `fatal: not a git repository (or any of the parent directories): .git`.

---

### Task 3: Add Static Config And Asset Tests

**Files:**
- Create: `test/static-assets.test.js`
- Modify: `package.json`
- Modify: `public/index.html`
- Create: `public/vendor/lucide.min.js`

- [ ] **Step 1: Write failing static tests**

Create `test/static-assets.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");

test("package scripts expose tests dry-run deploy and guarded remote commands", () => {
  const pkg = JSON.parse(read("package.json"));

  assert.equal(pkg.scripts.test, "node --test");
  assert.equal(pkg.scripts["check:deploy-config"], "node scripts/check-deploy-config.js");
  assert.equal(pkg.scripts["deploy:dry"], "wrangler deploy --dry-run");
  assert.equal(pkg.scripts.deploy, "npm run check:deploy-config && wrangler deploy");
  assert.equal(pkg.scripts["db:remote"], "npm run check:deploy-config && wrangler d1 migrations apply meter-usage --remote");
});

test("index uses local deterministic scripts", () => {
  const html = read("public/index.html");

  assert.doesNotMatch(html, /unpkg\.com|@latest/);
  assert.match(html, /src="\.\/vendor\/lucide\.min\.js"/);
  assert.match(html, /<script type="module" src="\.\/app\.js"><\/script>/);
  assert.equal(existsSync("public/vendor/lucide.min.js"), true);
});

test("index contains Balanced Console landmarks", () => {
  const html = read("public/index.html");

  for (const id of [
    "overviewSection",
    "quickEntryForm",
    "usageChart",
    "recordsBody",
    "forecastGrid",
    "settingsForm",
    "startupModal",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }

  for (const className of ["glass-rail", "glass-toolbar", "quick-entry-panel", "bottom-nav"]) {
    assert.match(html, new RegExp(`class="[^"]*${className}`));
  }
});

test("styles avoid external runtime imagery and define responsive glass layout", () => {
  const css = read("public/styles.css");

  assert.doesNotMatch(css, /url\(["']?https?:/);
  assert.doesNotMatch(css, /letter-spacing:\s*-/);
  assert.match(css, /\.glass-rail/);
  assert.match(css, /\.glass-toolbar/);
  assert.match(css, /\.bottom-nav/);
  assert.match(css, /@media\s*\(max-width:\s*760px\)/);
});
```

- [ ] **Step 2: Run static tests to verify RED**

Run:

```powershell
node --test test/static-assets.test.js
```

Expected: FAIL because scripts, local lucide, Balanced Console selectors, and CSS classes are not implemented yet.

- [ ] **Step 3: Update package scripts**

Modify `package.json` scripts to:

```json
{
  "dev": "wrangler dev",
  "test": "node --test",
  "deploy:dry": "wrangler deploy --dry-run",
  "check:deploy-config": "node scripts/check-deploy-config.js",
  "deploy": "npm run check:deploy-config && wrangler deploy",
  "db:local": "wrangler d1 migrations apply meter-usage --local",
  "db:remote": "npm run check:deploy-config && wrangler d1 migrations apply meter-usage --remote"
}
```

- [ ] **Step 4: Vendor the pinned lucide runtime**

Run:

```powershell
New-Item -ItemType Directory -Force -Path 'public\vendor' | Out-Null
Invoke-WebRequest -Uri 'https://unpkg.com/lucide@1.21.0/dist/umd/lucide.min.js' -OutFile 'public\vendor\lucide.min.js'
```

Expected: `public/vendor/lucide.min.js` exists and is served as a static asset by Wrangler.

- [ ] **Step 5: Defer static test GREEN to Tasks 4 and 5**

Do not change the test. It should remain failing until the HTML and CSS tasks implement the required selectors and classes.

---

### Task 4: Rebuild HTML Around Balanced Console

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Use the static test as RED**

Run:

```powershell
node --test test/static-assets.test.js
```

Expected: FAIL because `public/index.html` still lacks `quickEntryForm`, local module script loading, and the approved glass layout landmarks.

- [ ] **Step 2: Update script tags**

Replace the existing external lucide and app script lines with:

```html
<script defer src="./vendor/lucide.min.js"></script>
<script type="module" src="./app.js"></script>
```

- [ ] **Step 3: Replace navigation with labeled glass rail and mobile bottom nav**

Use this structure for navigation:

```html
<aside class="glass-rail" aria-label="主导航">
  <div class="brand-lockup" aria-hidden="true">
    <span class="brand-mark"><i data-lucide="activity"></i></span>
  </div>
  <button class="rail-button is-active" data-section="overview" type="button" aria-label="概览">
    <i data-lucide="layout-dashboard"></i><span>概览</span>
  </button>
  <button class="rail-button" data-section="records" type="button" aria-label="读数">
    <i data-lucide="clipboard-list"></i><span>读数</span>
  </button>
  <button class="rail-button" data-section="forecast" type="button" aria-label="预测">
    <i data-lucide="cloud-sun"></i><span>预测</span>
  </button>
  <button class="rail-button" data-section="settings" type="button" aria-label="设置">
    <i data-lucide="settings"></i><span>设置</span>
  </button>
</aside>

<nav class="bottom-nav" aria-label="移动主导航">
  <button class="rail-button is-active" data-section="overview" type="button" aria-label="概览">
    <i data-lucide="layout-dashboard"></i><span>概览</span>
  </button>
  <button class="rail-button" data-section="records" type="button" aria-label="读数">
    <i data-lucide="clipboard-list"></i><span>读数</span>
  </button>
  <button class="rail-button" data-section="forecast" type="button" aria-label="预测">
    <i data-lucide="cloud-sun"></i><span>预测</span>
  </button>
  <button class="rail-button" data-section="settings" type="button" aria-label="设置">
    <i data-lucide="settings"></i><span>设置</span>
  </button>
</nav>
```

- [ ] **Step 4: Replace the topbar with a glass toolbar**

Use this toolbar:

```html
<header class="glass-toolbar">
  <div>
    <p class="eyebrow">家庭能耗</p>
    <h1>能耗控制台</h1>
  </div>
  <div class="top-actions">
    <button class="ghost-button" id="refreshButton" type="button"><i data-lucide="refresh-cw"></i>刷新</button>
    <button class="primary-button" id="openEntryButton" type="button"><i data-lucide="plus"></i>录入读数</button>
  </div>
</header>
```

- [ ] **Step 5: Rework overview into Balanced Console**

The overview section must include:

```html
<section class="section-view is-visible" id="overviewSection">
  <div class="console-grid">
    <section class="panel chart-panel" id="overviewChartPanel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">每日消耗</p>
          <h2>近 30 天趋势</h2>
        </div>
        <div class="segmented" role="tablist" aria-label="图表类型">
          <button type="button" class="is-selected" data-chart-meter="electric">电</button>
          <button type="button" data-chart-meter="gas">燃气</button>
        </div>
      </div>
      <canvas id="usageChart" width="960" height="360" aria-label="每日消耗图表"></canvas>
      <div class="empty-state" id="chartEmpty">录入初始读数和下一条读数后生成曲线</div>
    </section>

    <section class="panel quick-entry-panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">快速录入</p>
          <h2>今日读数</h2>
        </div>
      </div>
      <form class="entry-form" id="quickEntryForm">
        <label>
          类型
          <select id="quickReadingMeterType">
            <option value="electric">电表</option>
            <option value="gas">燃气表</option>
          </select>
        </label>
        <label>
          日期
          <input id="quickReadingDate" type="date" required />
        </label>
        <label>
          累计读数
          <input id="quickReadingValue" type="number" min="0" step="0.01" inputmode="decimal" required />
        </label>
        <button class="primary-button" type="submit"><i data-lucide="save"></i>保存读数</button>
      </form>
      <p class="form-message" id="quickFormMessage" role="status"></p>
    </section>
  </div>

  <div class="metric-grid">
    <article class="metric-card electric-card">
      <div class="card-head"><span>当前电表</span><i data-lucide="gauge"></i></div>
      <strong id="electricCurrent">--</strong>
      <small>kWh</small>
    </article>
    <article class="metric-card gas-card">
      <div class="card-head"><span>当前燃气</span><i data-lucide="flame"></i></div>
      <strong id="gasCurrent">--</strong>
      <small>m³</small>
    </article>
    <article class="metric-card">
      <div class="card-head"><span>昨日用电</span><i data-lucide="activity"></i></div>
      <strong id="electricLast">--</strong>
      <small>kWh</small>
    </article>
    <article class="metric-card">
      <div class="card-head"><span>昨日燃气</span><i data-lucide="activity"></i></div>
      <strong id="gasLast">--</strong>
      <small>m³</small>
    </article>
  </div>

  <section class="panel insight-panel">
    <div class="panel-head">
      <div>
        <p class="eyebrow">摘要</p>
        <h2>近期变化</h2>
      </div>
    </div>
    <div class="insight-list" id="insightList"></div>
  </section>
</section>
```

Keep the existing record, forecast, settings, modal, and toast IDs so `app.js` can preserve behavior.

- [ ] **Step 6: Keep records form as a full history editor**

The records section keeps `entryForm`, `readingMeterType`, `readingDate`, `readingValue`, `formMessage`, `exportButton`, and `recordsBody`. Add copy that differentiates it from quick entry through headings only, not extra instructional text.

- [ ] **Step 7: Run static tests**

Run:

```powershell
node --test test/static-assets.test.js
```

Expected: still FAIL until Task 5 rewrites CSS, but the script and HTML selector failures should be resolved.

- [ ] **Step 8: Checkpoint**

Run:

```powershell
git status --short
```

Expected in this workspace: `fatal: not a git repository (or any of the parent directories): .git`.

---

### Task 5: Rewrite CSS As Liquid Glass Responsive System

**Files:**
- Modify: `public/styles.css`

- [ ] **Step 1: Use static CSS checks as RED**

Run:

```powershell
node --test test/static-assets.test.js
```

Expected: FAIL because `public/styles.css` currently uses an external background image and lacks the new glass selectors.

- [ ] **Step 2: Replace external background imagery with CSS-only system background**

Define root tokens and body background without `url(http...)`:

```css
:root {
  color-scheme: light;
  --bg-start: #eef6f5;
  --bg-mid: #f6f8fb;
  --bg-end: #f8f2e8;
  --surface: rgba(255, 255, 255, 0.68);
  --surface-strong: rgba(255, 255, 255, 0.88);
  --surface-soft: rgba(255, 255, 255, 0.46);
  --ink: #102034;
  --muted: #667789;
  --line: rgba(134, 154, 174, 0.26);
  --green: #15896f;
  --green-dark: #0d624f;
  --blue: #3e7ed8;
  --amber: #a66a2c;
  --red: #c84b4b;
  --shadow: 0 18px 50px rgba(20, 36, 52, 0.14);
  --glass-blur: blur(22px) saturate(1.35);
}

html {
  min-height: 100%;
  background: var(--bg-start);
}

body {
  min-height: 100vh;
  margin: 0;
  font-family: "Microsoft YaHei", "PingFang SC", "Segoe UI", Arial, sans-serif;
  color: var(--ink);
  background:
    radial-gradient(circle at 12% 8%, rgba(83, 153, 220, 0.20), transparent 30%),
    radial-gradient(circle at 88% 18%, rgba(234, 181, 87, 0.20), transparent 28%),
    linear-gradient(135deg, var(--bg-start), var(--bg-mid) 48%, var(--bg-end));
}
```

- [ ] **Step 3: Define glass layout classes**

Add these selectors and properties:

```css
.app-shell {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
  min-height: 100vh;
}

.glass-rail,
.bottom-nav,
.glass-toolbar,
.panel,
.metric-card,
.entry-modal .modal-card,
.toast {
  border: 1px solid rgba(255, 255, 255, 0.62);
  background: var(--surface);
  box-shadow: var(--shadow), inset 0 1px 0 rgba(255, 255, 255, 0.74);
  backdrop-filter: var(--glass-blur);
}

.glass-rail {
  position: sticky;
  top: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 96px;
  height: 100vh;
  padding: 18px 12px;
}

.glass-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 78px;
  margin-bottom: 16px;
  padding: 16px 18px;
  border-radius: 26px;
}

.bottom-nav {
  display: none;
}

.console-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.45fr) minmax(300px, 0.72fr);
  gap: 16px;
  margin-bottom: 16px;
}

.quick-entry-panel {
  min-height: 438px;
}
```

- [ ] **Step 4: Keep controls stable and accessible**

Ensure buttons and inputs use stable dimensions:

```css
.primary-button,
.ghost-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 44px;
  padding: 0 16px;
  border-radius: 16px;
  border: 1px solid transparent;
  font-weight: 800;
  white-space: nowrap;
}

input,
select {
  width: 100%;
  min-height: 46px;
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 0 12px;
  color: var(--ink);
  background: var(--surface-strong);
  outline: none;
}

input:focus,
select:focus,
button:focus-visible {
  outline: 3px solid rgba(21, 137, 111, 0.22);
  outline-offset: 2px;
}
```

- [ ] **Step 5: Add mobile breakpoint**

Include this breakpoint:

```css
@media (max-width: 760px) {
  .app-shell {
    display: block;
    padding-bottom: 84px;
  }

  .glass-rail {
    display: none;
  }

  .bottom-nav {
    position: fixed;
    z-index: 8;
    inset: auto 12px 12px;
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 6px;
    padding: 8px;
    border-radius: 24px;
  }

  .content {
    padding: 14px 12px 28px;
  }

  .glass-toolbar,
  .panel-head {
    align-items: flex-start;
    flex-direction: column;
  }

  .top-actions,
  .top-actions .primary-button,
  .top-actions .ghost-button,
  .segmented,
  .quick-entry-panel .primary-button {
    width: 100%;
  }

  .console-grid,
  .metric-grid,
  .dashboard-grid,
  .records-layout,
  .forecast-layout,
  .settings-layout,
  .address-grid {
    grid-template-columns: 1fr;
  }

  .forecast-grid {
    grid-template-columns: repeat(7, 132px);
  }
}
```

- [ ] **Step 6: Run static tests to verify GREEN for CSS and static assets**

Run:

```powershell
node --test test/static-assets.test.js
```

Expected: PASS.

- [ ] **Step 7: Checkpoint**

Run:

```powershell
git status --short
```

Expected in this workspace: `fatal: not a git repository (or any of the parent directories): .git`.

---

### Task 6: Refactor App Script For Domain Helpers And New UI

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: Write import-level expectation through existing tests**

Run:

```powershell
npm test
```

Expected before refactor: `test/static-assets.test.js` and domain tests pass after Tasks 1-5. This task must keep them passing.

- [ ] **Step 2: Import domain helpers**

At the top of `public/app.js`, add:

```js
import {
  METER_META,
  addDays,
  average,
  csvCell,
  daysBetween,
  getBaselineUsage as calculateBaselineUsage,
  getCurrentMonthUsage as calculateCurrentMonthUsage,
  getDailyUsages as calculateDailyUsages,
  round,
  sum,
  toDateInputValue,
} from "./domain.js";
```

Remove the local `METER_META`, `getDailyUsages`, `daysBetween`, `addDays`, `toDateInputValue`, `average`, `sum`, `round`, and `csvCell` implementations after their call sites have been updated.

- [ ] **Step 3: Add new quick-entry element IDs to cacheElements**

Add these IDs to the cached list:

```js
"quickEntryForm",
"quickFormMessage",
"quickReadingDate",
"quickReadingMeterType",
"quickReadingValue",
```

Keep the existing record form IDs so the records section still works.

- [ ] **Step 4: Set quick-entry default date**

In `setDefaultDates()`, set both entry forms:

```js
els.readingDate.value = today;
els.quickReadingDate.value = today;
els.initialDate.value = today;
els.startupDate.value = today;
```

- [ ] **Step 5: Share reading submit behavior**

Create this helper inside `public/app.js`:

```js
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
```

Use it for both `entryForm` and `quickEntryForm`.

- [ ] **Step 6: Make top action focus quick entry first**

Change the open-entry button handler to:

```js
els.openEntryButton.addEventListener("click", () => {
  switchSection("overview");
  els.quickReadingValue.focus();
});
```

- [ ] **Step 7: Wrap domain helper calls**

Replace local calculation functions with:

```js
function getDailyUsages(meterType) {
  return calculateDailyUsages(state.readings[meterType] || []);
}

function getBaselineUsage(meterType) {
  const meta = METER_META[meterType];
  const baselineDays = Number(state.settings?.forecast?.baselineDays || 14);
  return calculateBaselineUsage(state.readings[meterType] || [], {
    baselineDays,
    fallback: meta.defaultBaseline,
  });
}

function getCurrentMonthUsage(meterType) {
  return calculateCurrentMonthUsage(state.readings[meterType] || [], todayKey());
}
```

- [ ] **Step 8: Keep icon rendering local**

Leave `refreshIcons()` as:

```js
function refreshIcons() {
  if (window.lucide) window.lucide.createIcons();
}
```

The implementation must load `window.lucide` from `public/vendor/lucide.min.js`.

- [ ] **Step 9: Run tests after app refactor**

Run:

```powershell
npm test
```

Expected: PASS.

- [ ] **Step 10: Checkpoint**

Run:

```powershell
git status --short
```

Expected in this workspace: `fatal: not a git repository (or any of the parent directories): .git`.

---

### Task 7: Worker Deployment And Browser Verification

**Files:**
- Read/verify: `src/worker.js`
- Read/verify: `wrangler.toml`
- Verify generated local D1 state through Wrangler

- [ ] **Step 1: Run full test suite**

Run:

```powershell
npm test
```

Expected: PASS.

- [ ] **Step 2: Verify deploy guard blocks real deploy with placeholder**

Run:

```powershell
npm run check:deploy-config
```

Expected: exit code `1`, with a message explaining that `database_id = "replace-with-your-d1-database-id"` must be replaced after `npx wrangler d1 create meter-usage`.

- [ ] **Step 3: Verify dry-run bundling still works**

Run:

```powershell
npm run deploy:dry
```

Expected: PASS. Wrangler should read static assets from `public/` and report `env.DB` plus `env.ASSETS`.

- [ ] **Step 4: Apply local D1 migrations**

Run:

```powershell
npm run db:local
```

Expected: PASS, or a clear "already applied" migration state from Wrangler. If Wrangler reports a transient network fetch error while working with local D1, rerun once and preserve the final output in the final report.

- [ ] **Step 5: Start local Worker**

Run:

```powershell
npm run dev
```

Expected: Wrangler serves a local URL such as `http://127.0.0.1:8787` or the next available port. Keep the session running for browser checks.

- [ ] **Step 6: Verify API state**

Open the local `/api/state` URL in the browser or use:

```powershell
Invoke-WebRequest -Uri 'http://127.0.0.1:8787/api/state' -UseBasicParsing
```

Expected: HTTP 200 JSON with `settings`, `readings.electric`, and `readings.gas`. If Wrangler selected port `8788`, use `http://127.0.0.1:8788/api/state`.

- [ ] **Step 7: Verify desktop UI**

Use the in-app browser at the local Worker URL with the default desktop viewport.

Checks:

- Glass rail is visible.
- Glass toolbar is visible.
- Overview shows trend chart panel and quick-entry panel side by side.
- Metric cards are visible and text does not overlap.
- Records, forecast, and settings navigation buttons switch sections.
- Browser console has no uncaught module or icon-loading errors.

- [ ] **Step 8: Verify mobile UI**

Use the in-app browser viewport capability or Playwright viewport for a mobile width such as `390x844`.

Checks:

- Left rail is hidden.
- Bottom nav is visible and does not cover active form controls.
- Overview stacks quick entry, chart, and metrics without overlap.
- Modal fits within the viewport.
- Buttons retain usable touch height.

- [ ] **Step 9: Review Worker code without changing API contract**

Read `src/worker.js` and verify:

- `/api/state` still returns public settings and readings.
- `publicSettings()` masks `caiyunApiKey`.
- Reading order validation still blocks decreasing cumulative readings.
- Initial readings cannot be deleted from the records route.
- `PUT /api/settings` keeps settings save non-destructive when geocoding fails.
- `env.ASSETS.fetch(request)` still serves non-API requests.

Make no Worker change unless one of these checks fails.

- [ ] **Step 10: Stop local dev server**

Stop the Wrangler dev process after browser verification.

- [ ] **Step 11: Final verification gate**

Run fresh:

```powershell
npm test
npm run deploy:dry
npm run check:deploy-config
```

Expected:

- `npm test`: PASS.
- `npm run deploy:dry`: PASS.
- `npm run check:deploy-config`: FAIL by design while placeholder D1 ID remains, with the configured actionable message.

---

## Self-Review Checklist

- Spec coverage: the plan covers UI redesign, domain tests, deploy guard, local icon asset, package scripts, Worker dry-run, local D1, local browser checks, and code review.
- Placeholder scan: the only placeholder referenced is the intentional `replace-with-your-d1-database-id` deployment guard input.
- Type consistency: `public/domain.js` exports used by `public/app.js` match the test imports and planned app imports.
- Scope: no D1 schema changes, no API route changes, no frontend framework.
