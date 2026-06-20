# Auth Location iOS 27 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add login, forced password change, coordinate fallback, and the actual iOS-style glass UI while keeping Cloudflare Worker + D1 deployment intact.

**Architecture:** Keep `src/worker.js` as the Worker entrypoint and use the existing D1 `settings` table for auth and app settings. Rebuild the static UI with native HTML/CSS/JS, local lucide assets, and server-side API protection.

**Tech Stack:** Cloudflare Worker, D1, Workers Static Assets, native browser JavaScript, Web Crypto PBKDF2, Node `node:test`, Wrangler.

---

## File Structure

- Modify `src/worker.js`: auth endpoints, route protection, PBKDF2 helpers, session cookies, manual location endpoint.
- Modify `public/index.html`: login and password-change screens, glass app shell, bottom nav, quick entry, coordinate controls, local lucide script.
- Modify `public/styles.css`: iOS-style glass design system, auth screens, responsive desktop/mobile layouts, coordinate controls.
- Modify `public/app.js`: auth gate, login/change/logout handlers, protected API flow, quick entry, geolocation/manual location handlers.
- Create `public/vendor/lucide.min.js`: pinned local icon runtime.
- Create `test/worker-auth-location.test.js`: Worker API behavior tests with in-memory D1.
- Create `test/static-ui.test.js`: static HTML/CSS/runtime dependency checks.
- Modify `package.json`: add `test` and `deploy:dry`.
- Modify `README.md` and `DEPLOY.md`: login, location fallback, D1 binding, and Caiyun token handling.

## Tasks

- [ ] Write failing Worker tests for auth and manual location.
- [ ] Write failing static UI tests for login, coordinate controls, glass selectors, and local lucide.
- [ ] Implement Worker auth storage, password hashing, sessions, cookies, protected route gate, and `/api/settings/location`.
- [ ] Replace external lucide loading with `public/vendor/lucide.min.js`.
- [ ] Rebuild HTML for auth screens, glass app shell, balanced console overview, quick entry, and location controls.
- [ ] Rewrite CSS for Liquid Glass style, mobile bottom navigation, login/change-password panels, and stable controls.
- [ ] Update `app.js` to authenticate before loading app data, force password change, call protected APIs, save browser/manual coordinates, and preserve all existing meter workflows.
- [ ] Update docs without writing the Caiyun token into repository files.
- [ ] Run `npm test`.
- [ ] Run `npx wrangler deploy --dry-run`.
- [ ] Run local Worker and browser smoke checks for login, desktop UI, mobile UI, and coordinate controls.
- [ ] Commit, push to `main`, and run production deploy.

## TDD Notes

The first red tests should fail because auth endpoints, route protection, manual location endpoint, local lucide asset, and new DOM controls do not exist yet. Implementation then proceeds only until those tests pass.

## Verification Checklist

- `npm test`: all Worker and static tests pass.
- `npx wrangler deploy --dry-run`: Worker bundles with `ASSETS`.
- Local browser: unauthenticated app shows login; default login shows forced password change; changed password loads app; coordinate save updates location summary.
- Production browser: public URL serves the updated UI and no longer exposes business API responses without login.
