import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");

test("package exposes test and dry-run deployment scripts", () => {
  const pkg = JSON.parse(read("package.json"));

  assert.equal(pkg.scripts.test, "node --test");
  assert.equal(pkg.scripts["deploy:dry"], "wrangler deploy --dry-run");
});

test("index uses local deterministic scripts and auth DOM", () => {
  const html = read("public/index.html");

  assert.doesNotMatch(html, /unpkg\.com|@latest/);
  assert.match(html, /src="\.\/vendor\/lucide\.min\.js"/);
  assert.equal(existsSync("public/vendor/lucide.min.js"), true);

  for (const id of [
    "authShell",
    "loginForm",
    "loginUsername",
    "loginPassword",
    "changePasswordForm",
    "currentPassword",
    "newPassword",
    "confirmPassword",
    "appShell",
    "logoutButton",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});

test("index contains iOS glass layout and location fallback controls", () => {
  const html = read("public/index.html");

  for (const id of [
    "overviewSection",
    "quickEntryForm",
    "usageChart",
    "recordsBody",
    "forecastGrid",
    "settingsForm",
    "startupModal",
    "manualLatitude",
    "manualLongitude",
    "useCurrentLocationButton",
    "saveManualLocationButton",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }

  for (const className of ["glass-rail", "glass-toolbar", "quick-entry-panel", "bottom-nav", "liquid-panel"]) {
    assert.match(html, new RegExp(`class="[^"]*${className}`));
  }
});

test("styles define responsive glass UI without external runtime imagery", () => {
  const css = read("public/styles.css");

  assert.doesNotMatch(css, /url\(["']?https?:/);
  assert.doesNotMatch(css, /letter-spacing:\s*-/);
  assert.match(css, /\.auth-shell/);
  assert.match(css, /\.glass-rail/);
  assert.match(css, /\.glass-toolbar/);
  assert.match(css, /\.bottom-nav/);
  assert.match(css, /\.location-actions/);
  assert.match(css, /@media\s*\(max-width:\s*760px\)/);
});
