# Slice 3 — Daily-refresh snapshot job + marketing admin tab / headline strip

**Issue:** #659 (`[marketing]` — AI VP of Marketing)
**Net-new item:** report §12 #2 — *"`daily-refresh` snapshot job + the marketing admin tab/headline strip."*
**Status:** ANALYSIS / build-spec. Specs only — no feature code. One PR for this doc, off `origin/main`, NOT merged.
**Depends on:** slice 1 (`marketing` module + `marketing_metric_snapshot` model — PR #666). This slice consumes that table; do not start the build until slice 1 has merged.
**Grounded against** the live JYT codebase (every cited path verified 2026-06-23).

---

## 0. What this slice delivers

Two halves of one vertical, both reading/writing the slice-1 `marketing_metric_snapshot` table:

1. **`daily-refresh` scheduled job** — once a day, recompute the headline metrics from JYT's existing sources (orders, `analytics_daily_stats`, partner activations), **write append-only snapshot rows to Postgres first**, then warm the Redis cache. Mirrors the existing `aggregate-daily-analytics.ts` job exactly.
2. **Marketing admin tab + headline strip** — a top-level `/admin/marketing` route showing the One-Goal headline number + day-over-day delta + a small trend line, plus a secondary KPI strip. Reads through a **stale-while-revalidate** path: server serves the last snapshot instantly (it *is* the cache), client uses react-query `staleTime`/`placeholderData` so the page never blocks on a recompute.

> **The cache discipline (report §11.1 — "never hit a third-party API on page load") is satisfied structurally**: the admin tab reads *only* `marketing_metric_snapshot` rows that the cron already materialised. No integration call ever happens on a page load. This is the same shape #559 already uses (`analytics_daily_stats` is precomputed by `aggregate-daily-analytics.ts`; the admin UI reads the rollup, never the raw event stream).

---

## 1. ⚠️ Blocking product decision — the One Goal (report §1)

This slice is the **first place the One Goal actually changes shipped behaviour.** Slices 1 & 2 were goal-agnostic; slice 3 is not, in exactly one spot: **which `metric_key` renders as the big headline number** and which schedule the operator alert keys off.

| Candidate One Goal | Headline `metric_key` | Primary source |
|---|---|---|
| Platform GMV / net revenue | `platform_net_gmv` | paid orders (Order module), summed |
| Partner activation | `partners_activated` | partners with live storefront + ≥1 paid order |
| Storefront conversion | `storefront_conversion_rate` | `analytics_daily_stats` sessions → paid orders |

**The build is NOT blocked** — the job can compute *all three* metric families into the snapshot table (the schema is goal-agnostic per slice 1), and the admin tab can ship behind a single config constant `HEADLINE_METRIC_KEY`. **Only the choice of which key is the hero number + the alert trigger is blocked.** Recommendation in the report: start with **partner activation** or **GMV**. **Surface this on #659; do not pick it in the daemon.** Until picked, the build PR-3 below ships the headline behind a TODO constant defaulting to `platform_net_gmv` and the strip shows all KPIs equally weighted.

Secondary undecided (does NOT block this slice): Slack vs WhatsApp for the daily summary (that's slice in report §4.3 `daily-summary`, deferred); admin tab vs dedicated route — **this spec picks the admin route `/admin/marketing`** (mirrors `ad-planning`, zero new infra).

---

## 2. The `daily-refresh` scheduled job

### 2.1 Pattern to mirror (verified paths)
- **Job file shape:** `apps/backend/src/jobs/aggregate-daily-analytics.ts` —
  `export default async function fn(container: MedusaContainer)` +
  `export const config = { name, schedule }` (`apps/backend/src/jobs/aggregate-daily-analytics.ts:61`, `schedule: "0 1 * * *"` at `:63`).
- **Container resolves:** `container.resolve("logger")`, `container.resolve(ANALYTICS_MODULE)`, and the new `container.resolve(MARKETING_MODULE)` (slice 1).
- **Cross-module reads (orders, partners, sessions):** use **Query** (`const query = container.resolve(ContainerRegistrationKeys.QUERY)` → `query.graph({ entity, fields, filters })`), NOT a direct module service — this is the report §3 "Query vs module service" rule. `query.graph` field syntax uses the **`relation.*` suffix**, never `*relation` prefix (platform memory `reference_query_graph_field_syntax`).
- **Compute helpers stay pure + unit-tested:** mirror `apps/backend/src/modules/analytics/compute-daily-stats.ts` (`computeDailyStatsForWebsite`, `listWebsitesWithActivity`) — the job is thin I/O; the math lives in a pure module file so it's unit-testable without booting Medusa.

### 2.2 New files
```
apps/backend/src/jobs/marketing-daily-refresh.ts          # the cron entry (thin I/O)
apps/backend/src/modules/marketing/compute-snapshot.ts    # PURE: build metric rows from inputs
apps/backend/src/modules/marketing/__tests__/compute-snapshot.test.ts
apps/backend/src/modules/marketing/cache.ts               # thin ioredis SWR shim (see §4)
```

### 2.3 Job algorithm (write-to-Postgres-before-anything-else)
```
1. logger + resolve MARKETING_MODULE, ANALYTICS_MODULE, QUERY.
2. asOfDate = start-of-today in IST (business TZ — report §7 "date awareness").
   ⚠ cron fires in server TZ = UTC in prod → compute the IST calendar day
   explicitly; do not trust `new Date()` local TZ. (memory: cron is server-TZ.)
3. Gather inputs (each in try/catch, retry-with-backoff per report §8):
   - paid-order GMV: query.graph order totals over the window.
   - partner activations: query.graph partners w/ storefront + paid order.
   - storefront conversion: read precomputed analytics_daily_stats rows
     (NEVER recompute from raw events here — reuse #559's rollup).
4. computeSnapshotRows(inputs, asOfDate)  ← PURE, unit-tested. Returns
   [{ metric_key, metric_value, as_of_date, dod_delta, wow_delta, source }].
   - dod/wow deltas read the prior snapshot rows from the table (trend math).
5. PERSIST FIRST: marketingService.createMarketingMetricSnapshots(rows)
   (append-only — slice 1 model is insert-only; one row per metric_key per day;
   re-run upserts on (metric_key, as_of_date) so re-runs are idempotent).
6. THEN warm cache: write the latest headline+strip blob to Redis (§4). If this
   throws, the snapshot rows already survived → next page load falls back to DB.
7. logger.info summary counts. Never throw past step 5 (cache failures are soft).
```

### 2.4 Schedule + registration
- `export const config = { name: "marketing-daily-refresh", schedule: "0 1 * * *" }` — 1 AM UTC ≈ 6:30 AM IST, matching the report §4.3 "6am daily-refresh" intent. (If the operator wants exactly 6 AM IST, use `"30 0 * * *"`.)
- **No config-file registration needed for jobs** — Medusa auto-discovers `src/jobs/*.ts`. (Contrast: the *module* needs `medusa-config.ts` + `.prod.ts`; that was slice 1.)
- The job pulls in `MARKETING_MODULE` from `apps/backend/src/modules/marketing/index.ts` (slice 1).

### 2.5 Tests
- **Unit (pure):** `compute-snapshot.test.ts` — feed synthetic inputs + prior-day rows, assert metric rows, dod/wow deltas, zero-activity short-circuit, IST date boundary. Run with `TEST_TYPE=unit` (memory: unit specs under `src/modules` need the unit env).
- **No integration test for the cron itself** (jobs aren't HTTP). If a thin integration smoke is wanted, assert via the read route in §3.

---

## 3. Read API — `GET /admin/marketing/snapshots`

Mirror an existing admin list route exactly (report convention "mirror admin API, don't invent"); reference `apps/backend/src/api/admin/analytics-events/breakdown/route.ts` for the query-param + validator shape.

### 3.1 New files
```
apps/backend/src/api/admin/marketing/snapshots/route.ts     # GET list/latest
apps/backend/src/api/admin/marketing/snapshots/validators.ts
apps/backend/src/api/admin/marketing/headline/route.ts      # GET headline+strip blob (SWR-served)
```
> The slice-1 spec (#666) may already define the base `/admin/marketing` route surface — **reconcile at build time; do not duplicate the matcher.** If slice 1 only created the module, these two routes are net-new here.

### 3.2 `GET /admin/marketing/headline` — the SWR endpoint the strip calls
- Reads the **cached blob from Redis first** (`cache.ts` `getHeadlineCache()`); on miss, reads the latest snapshot rows straight from `marketing_metric_snapshot` via the module service and **lazily re-warms** the cache. Never recomputes; never calls an integration. This is the server half of stale-while-revalidate.
- Response: `{ headline: { metric_key, value, dod_delta, wow_delta, as_of_date }, strip: [ ...KPI rows ], trend: [ { as_of_date, value } ], stale: boolean, generated_at }`.
- `headline.metric_key` = `HEADLINE_METRIC_KEY` constant (the One-Goal hook — §1).

### 3.3 `GET /admin/marketing/snapshots?metric_key=&days=` — trend drill-down
- Returns the append-only rows for a metric over a window (for the trend line / a future drill-down table). Equality filter on `metric_key`, rolling `days` window — same param pattern as the breakdown route.

### 3.4 Tests
- **Integration (per-file only):** `pnpm test:integration:http:shared -- apps/backend/integration-tests/http/marketing/headline.spec.ts`
  - seed snapshot rows → assert `/headline` returns the right hero metric + deltas;
  - assert `/snapshots?metric_key=X&days=7` returns ordered rows;
  - assert empty-table → 200 with `headline: null` / `stale: true` (no 500).
  - ⚠ NEVER run the whole `integration-tests/http` dir (CREATE INDEX CONCURRENTLY vs TRUNCATE boot deadlock — daemon rule).

---

## 4. Stale-while-revalidate cache (reuse #559's Redis discipline)

### 4.1 Reuse, don't reinvent
JYT already runs a singleton ioredis client for analytics: `getIngestRedis()` at `apps/backend/src/modules/analytics/ingest-buffer.ts:117` (thin `ioredis` shims, `REDIS_URL`). **Mirror that shim style** in `marketing/cache.ts` — do NOT add a new Redis dependency or a second client pattern; copy the `getIngestRedis` singleton shape (or import the same pattern) keyed under a `marketing:headline` namespace.

### 4.2 Two layers of SWR
- **Server layer:** the cron writes the headline blob to Redis with a soft TTL (e.g. 26h, longer than the refresh interval so a skipped cron still serves yesterday's number flagged `stale: true`). `/headline` reads Redis → on miss reads Postgres → re-warms. The **`marketing_metric_snapshot` table is the durable cache**; Redis is the hot path. If Redis is down, Postgres still answers (graceful degradation, report §8).
- **Client layer (react-query):** the admin hook uses `staleTime` + `placeholderData` so the strip renders the last value <100ms and swaps in fresh data behind the scenes. Existing precedent: `apps/backend/src/admin/hooks/api/messaging.ts:201` (`staleTime: 60_000`), `currency.ts:36` (1h). Use `staleTime: 5 * 60 * 1000` (5 min) + `placeholderData: (prev) => prev` (keepPreviousData) so navigating back is instant and never flashes a spinner — only a skeleton on true cold load (memory: skeletons everywhere, never "Loading…").

---

## 5. Admin tab + headline strip (UI)

### 5.1 Pattern to mirror (verified paths)
- **Top-level nav route:** `apps/backend/src/admin/routes/ads/page.tsx` —
  `import { defineRouteConfig } from "@medusajs/admin-sdk"` + `export const config = defineRouteConfig({ label, icon })` (`apps/backend/src/admin/routes/ads/page.tsx:145`). Icon from `@medusajs/icons` (e.g. `ChartBar`, already used by `ad-planning`).
- **KPI card + landing layout:** `apps/backend/src/admin/routes/ad-planning/page.tsx` — `KPICard` component, `useQuery` + `sdk` from `../../lib/config`, Medusa-UI `Container/Heading/Text/Badge`, design tokens (`shadow-elevation-card-rest bg-ui-bg-component`, `text-ui-fg-subtle`). **Reuse this exact card shape** so the marketing tab visually matches.
- **Data hook:** new `apps/backend/src/admin/hooks/api/marketing.ts` mirroring `apps/backend/src/admin/hooks/api/analytics.ts` (react-query wrappers over `sdk.client.fetch`).

### 5.2 New files
```
apps/backend/src/admin/routes/marketing/page.tsx                  # /admin/marketing — nav + headline strip
apps/backend/src/admin/hooks/api/marketing.ts                    # useMarketingHeadline(), useMarketingTrend()
apps/backend/src/admin/components/marketing/headline-strip.tsx   # hero number + dod delta + trend sparkline
apps/backend/src/admin/components/marketing/kpi-strip.tsx        # secondary KPI cards (reuse KPICard shape)
```

### 5.3 Layout (report §4.1 / §4.2)
- **Headline strip (top):** one big number (the One-Goal `metric_key`), a `Badge` for the dod delta (green ↑ / red ↓ via `--ui` tokens, dark-mode-safe), the `as_of_date`, and a small trend sparkline from `/snapshots`. A subtle "as of <date> · updated <generated_at>" caption; if `stale: true`, a small yellow note ("showing last refresh") rather than blocking.
- **Secondary KPI strip:** the other snapshot metrics as `KPICard`s.
- The report's 3 uber-tabs (Overview / Active campaign / Social & Media) are **scoped OUT of this slice** — this slice ships Overview + headline only. Active-campaign and Social tabs are later slices (Social maps onto the existing social-platform module).
- **Skeletons** on cold load (memory rule); `placeholderData` prevents skeleton on warm nav.

### 5.4 UI verification is MANDATORY (daemon rule)
Admin UI changes **cannot** be verified by unit tests. The build PR for §5 must:
- run a live `yarn dev`, drive the page with the **playwright-skill / webapp-testing** skill, capture a screenshot of the rendered headline strip, and attach it to the PR.
- If dev/Playwright can't run in the build chunk, say so explicitly in the handoff and leave the UI render slice deferred (same pattern as #508's Playwright-gated render slice).

---

## 6. Ordered PR list (build phase — after One Goal picked or with the TODO-constant default)

| PR | Scope | Off / stacked | Verify |
|---|---|---|---|
| **3a** | Pure `compute-snapshot.ts` + unit tests (metric math, dod/wow deltas, IST boundary, zero-activity) | off `origin/main` (needs slice-1 model merged) | `TEST_TYPE=unit` per-file |
| **3b** | `marketing-daily-refresh.ts` cron + `cache.ts` Redis shim (writes Postgres first, warms cache) | stacked on 3a | typecheck; manual `medusa exec`-style dry run if feasible |
| **3c** | `GET /admin/marketing/snapshots` + `/headline` routes + validators | off `origin/main` (reconcile matcher w/ slice-1 route) | per-file integration spec (§3.4) |
| **3d** | Admin `/admin/marketing` route + headline strip + KPI strip + `marketing.ts` hook (SWR) | stacked on 3c (needs the read route) | **Playwright + screenshot** (§5.4) |

Each PR ≤ ~1 slice; mirror the #457/#559 cadence (small, audited, reviewed). Do not merge from the daemon — human review.

---

## 7. JYT gotchas this slice must respect (from platform memory)
- **No load-bearing data in `metadata`** — snapshot rows are typed columns (slice 1).
- **Two config files** — only relevant if slice 1's module registration is incomplete; jobs/routes/admin need no config edit.
- **`query.graph`** uses `relation.*` suffix; multi-hop joins don't auto-join through dot-paths — pivot via link tables (`reference_query_graph_filter_shapes`). Verify any orders/partners read with `medusa exec --dry-run` locally before merging.
- **Cron is server-TZ (UTC in prod)** — compute the IST business day explicitly in the job.
- **Unknown query param on a validated Medusa route 400s** (not ignored) — keep `/snapshots` validators in sync with what the hook sends (bit #508's All-runs tab).
- **`toast` from `@medusajs/ui`, not sonner** — if the tab adds any toast.
- **Per-file integration tests only**; **never call a live LLM or send real email** here (this slice does neither — it's pure read/aggregate).

---

## 8. Out of scope (later slices / not in report §12)
- The AI tactical-ideas email + hallucination guard (slice 2 — PR #667).
- `daily-summary` to Slack/WhatsApp (report §4.3) — depends on the Slack-vs-WhatsApp decision.
- Newsletter draft generator (report §12 #4).
- `marketing_outreach` + `WinbacksView` (report §12 #5 — next slice spec, slice 4).
- The Active-campaign + Social & Media uber-tabs (report §4.2) — future.
- Public read-only chatbot (report §9 — last).

---

*Grounded paths cited (all verified to exist 2026-06-23): `apps/backend/src/jobs/aggregate-daily-analytics.ts` (`:61` config, `:63` schedule), `apps/backend/src/jobs/drain-analytics-buffer.ts` (`:103/:107` sub-daily cron), `apps/backend/src/modules/analytics/compute-daily-stats.ts`, `apps/backend/src/modules/analytics/ingest-buffer.ts:117` (`getIngestRedis`), `apps/backend/src/api/admin/analytics-events/breakdown/route.ts`, `apps/backend/src/admin/routes/ads/page.tsx:145` (`defineRouteConfig`), `apps/backend/src/admin/routes/ad-planning/page.tsx` (`KPICard`), `apps/backend/src/admin/hooks/api/analytics.ts`, `apps/backend/src/admin/hooks/api/messaging.ts:201` / `currency.ts:36` (`staleTime`).*
