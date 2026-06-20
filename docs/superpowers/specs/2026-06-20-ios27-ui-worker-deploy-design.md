# iOS 27 Glass UI And Worker Deployment Design

Date: 2026-06-20
Project: `J:\电表统计`

## Context

The project is a lightweight Cloudflare Worker application:

- `src/worker.js` serves `/api/*` and delegates all other requests to Workers Static Assets through `env.ASSETS.fetch(request)`.
- `public/index.html`, `public/styles.css`, and `public/app.js` implement the browser UI.
- `migrations/0001_initial.sql` defines the D1 `readings` and `settings` tables.
- `wrangler.toml` binds `env.DB` to D1 and `env.ASSETS` to static assets.
- The workspace is not a git repository, so the Superpowers design-document commit step cannot be performed.

Current deployment dry-run evidence from this workspace:

- `npx wrangler --version` reports Wrangler `4.103.0`.
- `npx wrangler deploy --dry-run` can bundle the Worker, read the three files in `public/`, and detect `env.DB` plus `env.ASSETS`.
- `wrangler.toml` still contains `database_id = "replace-with-your-d1-database-id"`, so real remote deploy and remote D1 migration must be guarded until a real D1 UUID is provided.

## Approved Direction

The approved scope is Option C from requirements discussion: refactor the full UI, review and fix code risks, and ensure the project is ready to deploy to Cloudflare Workers.

The approved design approach is:

- Visual direction: **Productivity Glass Console**.
- Homepage composition: **Balanced Console**.
- Device strategy: desktop and mobile are equally important.
- Deployment strategy: keep the placeholder D1 ID in the repo, but add a deployment guard that prevents accidental real deploys while the placeholder remains.

This design translates iOS 27 / Liquid Glass principles into a static web application: glass materials are used for navigation, toolbars, sheets, and panel shells, while dense data areas such as tables, forms, and chart labels keep strong contrast and stable dimensions.

## UI Design

Desktop uses a productivity-console layout:

- Keep a left navigation rail, restyled as a glass surface with clear active, hover, and focus states.
- Replace the current top area with a glass toolbar containing the current section title, compact status, refresh, and quick-entry actions.
- Use the Balanced Console homepage:
  - Top area: toolbar and status.
  - Main area: usage trend and quick-entry form side by side.
  - Secondary area: electric, gas, recent usage, weather, and D1 status metrics.
- Keep records, forecast, and settings as separate views instead of crowding the homepage.
- Keep charts and tables readable with high-contrast text, stable spacing, and non-overlapping labels.

Mobile uses a phone-first adaptation of the same hierarchy:

- Collapse the left rail into a bottom glass navigation bar.
- Keep quick entry and trend summary near the top of the overview.
- Stack metrics vertically with stable touch targets.
- Keep primary buttons at least 44px tall.
- Avoid bottom navigation covering the toast, modal sheet, or form controls.
- Render reading records in a narrow-screen-friendly format or with deliberate horizontal scrolling.

Visual language:

- Use a soft multi-color background rather than a single dominant hue.
- Keep green as the main energy/status color.
- Use amber for gas and warnings, blue for weather/forecast, and graphite for text and neutral surfaces.
- Apply glass material to navigation, toolbars, panel shells, modals, and important controls.
- Avoid nested cards and avoid glass-on-glass content stacks that reduce legibility.
- Keep letter spacing at `0`.
- Do not scale font sizes directly with viewport width.
- Use lucide icons from a local static asset or fixed local copy, not `https://unpkg.com/lucide@latest`.

## Frontend Structure

The application remains native HTML/CSS/JavaScript. No React, Vue, Vite, or other frontend framework is introduced.

Files:

- Modify `public/index.html` for the new Balanced Console structure.
- Rewrite `public/styles.css` around a small design system for glass surfaces, layout, controls, responsive navigation, tables, forms, modals, and toasts.
- Modify `public/app.js` to use imported pure helpers, preserve API calls, bind the new DOM structure, and render the approved UI.
- Add `public/domain.js` for pure business logic that can run in both browser and Node tests.
- Add `test/domain.test.js` for Node's built-in test runner.

Pure logic to move into `public/domain.js`:

- Daily usage interpolation from cumulative readings.
- Baseline usage calculation.
- Current-month usage calculation.
- Date helpers used by usage calculations.
- Numeric rounding.
- CSV cell escaping.
- Meter metadata that does not depend on DOM.

Behavior intentionally kept in `public/app.js`:

- DOM querying and event listeners.
- API requests.
- Modal and toast behavior.
- Canvas chart rendering.
- Section navigation state.
- Form synchronization with settings.

## Test Design

Use Node's built-in `node:test` and `assert/strict`, avoiding a heavier testing dependency.

Tests should cover:

- Adjacent readings produce the correct daily usage.
- Multi-day gaps generate one usage row per day and evenly distribute usage.
- Baseline usage uses the latest N daily usages when available.
- Baseline usage falls back to default values when no readings exist.
- Current-month usage counts only the current month.
- CSV cells escape commas, quotes, and newlines correctly.
- Date helpers produce stable `YYYY-MM-DD` values.

The tests focus on behavior, not implementation details or DOM internals.

## Cloudflare Worker Deployment Design

Keep the current Worker architecture:

- `src/worker.js` remains the Worker entrypoint.
- `/api/*` remains the API prefix.
- `env.DB` remains the D1 binding.
- `env.ASSETS.fetch(request)` remains the static asset fallback.
- The D1 schema remains unchanged.

Add a deploy guard:

- Add `scripts/check-deploy-config.js`.
- The script reads `wrangler.toml`.
- It fails when `database_id` is missing, empty, or equal to `replace-with-your-d1-database-id`.
- It prints an actionable message telling the user to run `npx wrangler d1 create meter-usage` and replace the generated UUID.
- `npm run deploy` runs the guard before `wrangler deploy`.
- `npm run db:remote` runs the guard before applying remote migrations.
- `npm run deploy:dry` runs `wrangler deploy --dry-run` and does not require a real D1 ID.

Package scripts:

- Add `test`.
- Add `check:deploy-config`.
- Add `deploy:dry`.
- Change `deploy` to run the guard before deploying.
- Change `db:remote` to run the guard before remote migration.

## Review Fixes

Fixes included in this scope:

- Remove the runtime dependency on `https://unpkg.com/lucide@latest`.
- Ensure production static assets are deterministic and served by Cloudflare Workers Static Assets.
- Preserve API key masking: the front end must not receive the Caiyun API key in plaintext.
- Preserve reading-order validation.
- Preserve the rule that initial readings cannot be deleted from the records table.
- Keep address geocoding failure non-destructive for settings saves.
- Keep API errors as JSON responses with `cache-control: no-store`.
- Add tests for extracted pure logic.
- Verify the Worker dry-run bundle after changes.

Out of scope:

- Changing D1 schema.
- Changing API route names.
- Adding authentication.
- Replacing OpenStreetMap Nominatim or Caiyun Weather providers.
- Deploying to remote Cloudflare without a real D1 `database_id`.
- Introducing a frontend framework.

## Acceptance Criteria

The implementation is acceptable when:

- The UI follows the approved Productivity Glass Console and Balanced Console design.
- Desktop layout keeps a glass side rail, toolbar, balanced overview, readable charts, and usable tables.
- Mobile layout uses bottom glass navigation and does not overlap controls, modals, or toast messages.
- The app still supports initial readings, daily readings, delete non-initial reading, CSV export, settings save, weather refresh, chart switching, and startup/daily prompts.
- `npm test` passes.
- `npm run deploy:dry` passes.
- `npm run check:deploy-config` fails with the placeholder D1 ID and explains how to fix it.
- After a real D1 ID is supplied, `npm run check:deploy-config` can pass.
- `npm run dev` can serve the app locally.
- `/api/state` returns JSON when local D1 migrations are applied.

## References

- Apple Human Interface Guidelines and developer material for Liquid Glass design direction.
- Cloudflare Workers Static Assets documentation for assets bindings and Worker asset serving.
- Cloudflare D1 and Wrangler documentation for migrations and D1 database bindings.
