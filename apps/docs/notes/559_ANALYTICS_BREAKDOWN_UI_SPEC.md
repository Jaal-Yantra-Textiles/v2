# #559 Slice 4 — OpenPanel-style Analytics Breakdown UI (spec)

Status: **hooks + spec shipped (this PR); render slice DEFERRED** (Playwright-gated;
the headless PR daemon cannot boot Medusa admin + Playwright to visually verify a
React render, so the interactive page is left for an interactive session).

This note is the grounded build plan for the explorable breakdown UI. The
verifiable, headless-friendly part — typed react-query hooks over the slice-3
endpoint + a pure, unit-tested query builder — ships now. The render slice that
mounts these into the admin page is specified here so the next interactive
session can build + Playwright-verify it directly.

## What shipped in this PR (verifiable, no render)

- `apps/backend/src/admin/hooks/api/analytics-breakdown-query.ts` — **pure,
  framework-free**: `BreakdownDimension`, `BREAKDOWN_DIMENSIONS`,
  `FILTERABLE_FIELDS`, `BreakdownBucket`, `BreakdownResult`,
  `AnalyticsBreakdownResponse`, `BreakdownQueryParams`, `buildBreakdownQuery()`,
  `isBreakdownDimension()`. Mirrors the server contract in
  `src/workflows/analytics/reports/breakdown-lib.ts` +
  `src/api/admin/analytics-events/breakdown/route.ts` (slice 3 / PR #562).
- `apps/backend/src/admin/hooks/api/analytics.ts` — `useAnalyticsBreakdown(params, opts?)`
  react-query hook calling `GET /admin/analytics-events/breakdown`; re-exports the
  types/consts so components import from one place. Disabled until `website_id`
  and `dimension` are set; query key is `["analytics-breakdown", params]`.
- `__tests__/analytics-breakdown-query.unit.spec.ts` — 12 unit tests
  (`TEST_TYPE=unit`) covering query building (days-vs-range precedence, limit,
  filter coercion/blank-drop/unknown-key rejection) and the dimension guard.

## Server contract recap (slice 3 / PR #562)

`GET /admin/analytics-events/breakdown`
- Required: `website_id`, `dimension` (one of the 14 `BREAKDOWN_DIMENSIONS`).
- Window: rolling `days` (wins) OR explicit `start_date`/`end_date` ISO.
- `limit` (default 20, server clamps 1–100).
- Any filterable field as a query key = AND equality filter (e.g.
  `?dimension=pathname&device_type=mobile&country=IN`). Null rows match canonical
  labels (`referrer_source=direct`, `country/device_type/event_type=unknown`,
  others `(none)`; `is_404=true|false`).
- Response: `{ website_id, dimension, period, filters, breakdown: { dimension,
  total_events, total_unique_visitors, results: BreakdownBucket[] } }` where each
  bucket = `{ value, count, unique_visitors, percentage }`, sorted count-desc.

## Render slice (DEFERRED — interactive session)

Target surface: `src/admin/routes/websites/[id]/analytics/page.tsx` →
`components/websites/website-analytics-modal.tsx` (655 lines; recharts +
`@medusajs/ui` `Container`/`Heading`/`Text`/`Badge`). Add a **"Breakdown / Explore"**
section below the existing overview cards — do NOT replace the live panel or the
existing charts.

OpenPanel-style interaction:
1. **Dimension picker** — a `Select` (or segmented `Tabs`) over `BREAKDOWN_DIMENSIONS`
   with human labels (Country, Device, Browser, OS, Referrer, UTM Source…, Path,
   404?, Event Type, Event Name). Drives `params.dimension`.
2. **Window control** — reuse the page's existing days/from-to filter state; map to
   `days` or `start_date`/`end_date`.
3. **Filter chips** — clicking a bucket row adds `{ [currentDimension]: value }` to
   `params.filters` as a removable chip, then the user can switch dimension to
   drill down (classic OpenPanel "click to filter, switch dimension" flow). Chips
   render the active `filters` map; an "x" removes one.
4. **Breakdown table/bars** — `useAnalyticsBreakdown(params)` → render
   `breakdown.results` as a ranked list: value label, a proportional bar
   (`percentage`), `count`, and `unique_visitors`. Show
   `total_events`/`total_unique_visitors` as the section header. Cap visible rows
   with `limit` (default 20) + a "Show more" that bumps `limit`.

UX/styling rules (per project conventions in memory):
- **Medusa-native tokens only** — `--ui-*` / `--elevation-*` CSS vars, no hardcoded
  colors, so dark mode follows for free.
- **Skeletons, never "Loading…"** — skeleton the bar rows (`isLoading` from the
  hook) so layout doesn't jump.
- Empty state when `results.length === 0` ("No events for this dimension in the
  selected window").

Verification (interactive only): `yarn dev`, open
`/app/websites/:id/analytics`, drive the dimension picker + a filter chip with the
`playwright-skill` / `webapp-testing` skill against the live admin, screenshot the
breakdown rendering and a drill-down. Unit tests do NOT substitute for UI sign-off.

## Watch-outs

- Keep `analytics-breakdown-query.ts` in sync with `breakdown-lib.ts` if the
  server dimension/filter set changes (single source on the server; this is a
  typed mirror for the admin bundle, which is tsconfig-excluded).
- The endpoint only exists once **PR #562** merges; the hook is decoupled (URL
  fetch) so this PR is independent off `main`, but the render slice should land
  after #562 is live.
