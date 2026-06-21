# Analytics Module Analysis (#559 / #569)

## Purpose

The analytics module (`custom_analytics`) implements a self-hosted, privacy-focused web analytics system for JYT's website-builder platform. It tracks pageviews and custom events, derives session-based engagement metrics, runs daily aggregations, and exposes a rich query layer for the admin dashboard (#569, OpenPanel-style visitor UI). Ingestion supports a synchronous write-through path and an optional Redis-backed batch path (`ANALYTICS_BATCH_INGEST`) that decouples the visitor request from the DB write.

---

## Data Models

Three MikroORM models are defined under `apps/backend/src/modules/analytics/models/`. All three carry a `website_id` text column (a loose foreign key); only `AnalyticsEvent` has a formal Medusa `defineLink` to `Website` explicitly.

### analytics_event (`apps/backend/src/modules/analytics/models/analytics-event.ts`)

Stores individual pageview and custom_event rows — the raw fact table.

| Field | Type | Notes |
|---|---|---|
| `id` | `model.id().primaryKey()` | Auto-generated |
| `event_id` | `model.text().nullable()` | Client-supplied idempotency key for batch-ingest dedupe. Added by `apps/backend/src/modules/analytics/migrations/Migration20260619000000.ts`. Null for the synchronous `/web/analytics/track` path. |
| `website_id` | `model.text()` | FK to Website (via `apps/backend/src/links/website-analytics-link.ts` read-only link) |
| `event_type` | `model.enum(["pageview", "custom_event"]).default("pageview")` | |
| `event_name` | `model.text().nullable()` | For custom events |
| `pathname` | `model.text()` | URL path |
| `referrer` | `model.text().nullable()` | Full referrer URL |
| `referrer_source` | `model.text().nullable()` | Derived: "google", "direct", "facebook", domain, etc. |
| `visitor_id` | `model.text()` | Hashed fingerprint (client-generated) |
| `session_id` | `model.text()` | Client-generated session ID |
| `user_agent` | `model.text().nullable()` | Raw UA string |
| `browser` | `model.text().nullable()` | Parsed: "Chrome", "Firefox", etc. |
| `os` | `model.text().nullable()` | Parsed: "macOS", "Windows", etc. |
| `device_type` | `model.enum(["desktop","mobile","tablet","unknown"]).default("unknown")` | |
| `country` | `model.text().nullable()` | Country-level only (privacy) |
| `utm_source/medium/campaign/term/content` | `model.text().nullable()` | UTM parameters |
| `query_string` | `model.text().nullable()` | Full URL query string |
| `is_404` | `model.boolean().default(false)` | Error tracking |
| `metadata` | `model.json().nullable()` | Arbitrary extra data (also carries `locale` for language/region analytics) |
| `timestamp` | `model.dateTime()` | Event time |

Indexes (composite):
- `[website_id, timestamp]` — primary query axis
- `[website_id, pathname, timestamp]` — page breakdown
- `[session_id]` — session lookup
- `[visitor_id]` — visitor lookup
- `[website_id, event_type, timestamp]` — event type filtering
- `[event_id]` — idempotency dedupe

### analytics_session (`apps/backend/src/modules/analytics/models/analytics-session.ts`)

Derived session rows (upserted by `trackAnalyticsEventWorkflow`). **No formal `defineLink` to Website** — resolved at runtime via container.

| Field | Type | Notes |
|---|---|---|
| `id` | `model.id().primaryKey()` | |
| `website_id` | `model.text()` | |
| `session_id` | `model.text().unique()` | Client-generated |
| `visitor_id` | `model.text()` | |
| `entry_page` | `model.text()` | First pageview pathname |
| `exit_page` | `model.text().nullable()` | Last pageview pathname |
| `pageviews` | `model.number().default(1)` | Incremented per event |
| `duration_seconds` | `model.number().nullable()` | |
| `is_bounce` | `model.boolean().default(false)` | True when single pageview |
| `referrer` | `model.text().nullable()` | |
| `referrer_source` | `model.text().nullable()` | |
| `country` | `model.text().nullable()` | |
| `device_type` | `model.text().nullable()` | |
| `browser` | `model.text().nullable()` | |
| `os` | `model.text().nullable()` | |
| `utm_source/medium/campaign/term/content` | `model.text().nullable()` | First-touch attribution — captured on session creation, NOT updated on subsequent events |
| `started_at` | `model.dateTime()` | |
| `ended_at` | `model.dateTime().nullable()` | |
| `last_activity_at` | `model.dateTime()` | Updated on every event |

Unique index on `session_id`; composite indexes on `[website_id, started_at]`, `[website_id, is_bounce]`, `[utm_campaign]` (for ad-planning attribution).

### analytics_daily_stats (`apps/backend/src/modules/analytics/models/analytics-daily-stats.ts`)

Pre-computed daily rollup, populated by `aggregate-daily-analytics` cron job. **No formal `defineLink` to Website**.

| Field | Type | Notes |
|---|---|---|
| `id` | `model.id().primaryKey()` | |
| `website_id` | `model.text()` | |
| `date` | `model.dateTime()` | Date part only (time zeroed) |
| `pageviews` | `model.number().default(0)` | |
| `unique_visitors` | `model.number().default(0)` | |
| `sessions` | `model.number().default(0)` | |
| `bounce_rate` | `model.float().default(0)` | Percentage |
| `avg_session_duration` | `model.float().default(0)` | Seconds |
| `top_pages` | `model.json().nullable()` | `[{item, count}]` |
| `top_referrers` | `model.json().nullable()` | `[{item, count}]` |
| `top_countries` | `model.json().nullable()` | `[{item, count}]` |
| `desktop/mobile/tablet_visitors` | `model.number().default(0)` | |
| `browser_stats` | `model.json().nullable()` | `[{item, count}]` |
| `os_stats` | `model.json().nullable()` | `[{item, count}]` |

Unique composite index on `[website_id, date]`; index on `[date]`.

---

## Ingestion Path

### Entry: `POST /web/analytics/track`

**Source:** `apps/backend/src/api/web/analytics/track/route.ts:172` (`POST` handler, `AUTHENTICATE = false` at line 256)

Public, unauthenticated endpoint. Accepts a `TrackEventSchema`-validated body (Zod, at line 90). The handler captures `user-agent` and `x-forwarded-for` / `remoteAddress` from request headers (lines 181–182).

### Hybrid batching path (lines 190–228)

When `ANALYTICS_BATCH_INGEST` env flag is `"1"`/`"true"`/`"yes"`/`"on"` (checked at `apps/backend/src/modules/analytics/lib/ingest-buffer.ts:54`) AND the event is NOT a heartbeat (checked at `ingest-buffer.ts:63`), the event is `LPUSH`ed to a Redis list key `analytics:ingest:buffer` (producer at `ingest-buffer.ts:129`). The request returns `200 {"success": true, "message": "Event queued"}` without touching the DB.

**Key detail:** the full `user_agent` and `ip_address` are captured in the Medusa request and serialised into the buffer payload (`ingest-buffer.ts:23` — `BufferedAnalyticsEvent` type includes `user_agent`, `ip_address`, `timezone`, `locale`, `country`). This means the async drain path retains the same device/geo fidelity as the synchronous path (unlike the now-removed Cloudflare edge worker, per the docblock at `ingest-buffer.ts:13`).

If Redis push fails (e.g. Redis down), the handler falls through to the synchronous path (line 221 — `console.error` then writes through). Events are NEVER silently dropped.

### Synchronous write-through path (lines 230–238)

Runs `trackAnalyticsEventWorkflow` directly. This path is taken when:
- Batch ingest is disabled
- The event is a heartbeat (`custom_event` with `event_name === "heartbeat"`)
- Redis buffer push fails

### `trackAnalyticsEventWorkflow`

**Source:** `apps/backend/src/workflows/analytics/track-analytics-event.ts:285`

Two-step Medusa workflow:

**Step 1 — `createAnalyticsEventStep` (line 125):**
- Parses `user_agent` via inline `parseUserAgent()` (line 14): detects browser, OS, device type
- Extracts `referrer_source` via inline `extractReferrerSource()` (line 44): maps referrer hostname to known sources (google, bing, facebook, twitter, etc.) or the raw domain
- Resolves country via `resolveEventCountry()` from `apps/backend/src/modules/analytics/lib/country-from-timezone.ts:171`:
  **Precedence:** 1) explicit `country` param (from proxy/edge), 2) browser IANA timezone → country lookup via `TIMEZONE_COUNTRY` map (`country-from-timezone.ts:28`), 3) GeoIP-of-IP fallback via `geoip-lite` (`track-analytics-event.ts:73`)
- Carries browser `locale` into event `metadata` (line 148 — stored as JSON blob; never updated)
- Creates `AnalyticsEvent` row via `analyticsService.createAnalyticsEvents()`
- Emits `analytics_event.created` event on the event bus (line 180)

**Step 2 — `updateSessionStep` (line 196):**
- Looks up existing session by `session_id` via `analyticsService.listAndCountAnalyticsSessions`
- **Session found (existing):** updates `exit_page`, increments `pageviews`, sets `last_activity_at`, sets `is_bounce = false`. UTM fields are **first-touch only** — backfilled only if the session's `utm_campaign` is not already set (line 228)
- **Session not found (new):** creates session with `pageviews: 1`, `is_bounce: true`, captures UTM params from the first pageview
- Duration is NOT computed here — kept as `null` initially

**Compensation:** both steps have rollback handlers that call `softDeleteAnalyticsEvents` / `deleteAnalyticsSessions` on failure.

### Redis batch drain job

**Source:** `apps/backend/src/jobs/drain-analytics-buffer.ts:34`

Medusa cron job scheduled at `* * * * *` (every minute). Config at line 103.

- Guards with `locking.execute(LOCK_KEY = "analytics-buffer-drain")` to prevent overlapping ticks / multi-instance double-processing
- RPOPs up to `ANALYTICS_DRAIN_MAX` (default 500, line 28) entries from the Redis list
- Calls `orderAndDedupeBuffer()` (`ingest-buffer.ts:75`) to sort ascending by timestamp and drop duplicate `event_id`s within the batch — ensures session entry/exit/bounce computation stays correct
- Iterates each event and runs `trackAnalyticsEventWorkflow` — the **identical** workflow used by the synchronous path (line 53)
- Per-event failures do NOT abort the batch (line 80 — `failed++`, logged, continues)
- Lock contention skips the tick (line 95 — logged as warning, next tick retries)

---

## Sessionization

Sessions are **not derived in a batch job**. They are upserted synchronously in `trackAnalyticsEventWorkflow`'s `updateSessionStep` (`track-analytics-event.ts:196`). Each incoming event either creates a new session or updates the existing one for that `session_id`.

Key behaviours:
- `is_bounce` starts as `true` on creation, set to `false` as soon as a second pageview arrives for the same `session_id` (line 225)
- `exit_page` is updated on every event to the latest `pathname`
- `duration_seconds` is NOT computed in real-time — it stays `null` and is only computed in the daily stats rollup (from `started_at` to `ended_at`, presumably)
- UTM fields are **first-touch**: only set on session creation; subsequent events with different UTM values are ignored (`track-analytics-event.ts:228` — `!(session as any).utm_campaign && input.utm_campaign` guard)

**No separate session-migration or session-end job exists** (unverified — there may be a post-processing step for ended_at/duration that I did not find; the `backfill-bounce-rate.ts` script suggests some fields are backfilled post-hoc).

---

## Daily Stats Rollup

### `aggregate-daily-analytics` job

**Source:** `apps/backend/src/jobs/aggregate-daily-analytics.ts`

Medusa cron scheduled at `0 1 * * *` (daily at 1 AM), config at line 61.

1. Gets `yesterday` date (midnight, line 22)
2. Calls `listWebsitesWithActivity()` (`apps/backend/src/modules/analytics/lib/compute-daily-stats.ts:136`) — queries events and sessions for the day, collects distinct `website_id`s
3. For each website, calls `computeDailyStatsForWebsite()` (`compute-daily-stats.ts:48`):
   - Lists analytics events with `select: ["website_id", "event_type", "visitor_id", "session_id", "pathname", "referrer_source"]`, `take: 100000`
   - Lists analytics sessions with `select: ["visitor_id", "is_bounce", "duration_seconds", "device_type", "browser", "os", "country"]`, `take: 100000`
   - Computes: `pageviews` count, `unique_visitors` (Set of visitor_ids from events), `session_count`, `bounce_rate`, average session duration, device splits (`visitorCountByDevice`), `top_pages`/`top_referrers`/`top_countries`/`browser_stats`/`os_stats` via `topItems()` helper (frequencies, top 10 by default)
   - If both events and sessions are empty for the day, returns `null` (no row written)
4. **Upserts** the row: if an `analytics_daily_stats` row already exists for that `website_id + date`, calls `updateAnalyticsDailyStats`; otherwise `createAnalyticsDailyStats`

The unique composite index on `[website_id, date]` enforces one row per website per day.

---

## Read / Query Path

### Admin API endpoints

#### `GET /admin/websites/:id/analytics` — Website Analytics Overview
**Source:** `apps/backend/src/api/admin/websites/[id]/analytics/route.ts:45`

Calls `getWebsiteAnalyticsOverviewWorkflow` (`apps/backend/src/workflows/analytics/get-website-analytics-overview.ts:184`):
- Uses `query.graph()` via the read-only module link (`apps/backend/src/links/website-analytics-link.ts`) to fetch website + its `analytics_event.*` in one query
- Filters events client-side by date range, UTM filters, pathname substring, and QR key/value
- Computes event-level stats (total pageviews, unique visitors/sessions, recent 100 events)
- Also fetches `analytics_session` rows via service direct (best-effort, ignores errors) and computes session engagement metrics via `computeSessionMetrics()` (`apps/backend/src/workflows/analytics/session-metrics-lib.ts:42`): `total_sessions`, `bounce_rate`, `avg_session_duration`, `pages_per_session`, `views_per_visitor`
- **Best-effort**: session metrics degrade to zero on error, never throw

#### `GET /admin/websites/:id/analytics/sessions` — Paginated Sessions List (#569 S7a)
**Source:** `apps/backend/src/api/admin/websites/[id]/analytics/sessions/route.ts:33`

Calls `getWebsiteSessionsWorkflow` (`apps/backend/src/workflows/analytics/reports/get-website-sessions.ts:76`):
- Paginated via `resolveSessionListParams()` (`apps/backend/src/workflows/analytics/reports/sessions-list-lib.ts:97`): clamps limit to [1, 100], whitelists `order_by` to `SESSION_ORDER_FIELDS` (started_at, last_activity_at, ended_at, duration_seconds, pageviews), defaults to `started_at DESC`
- Sessions fetched directly from `custom_analytics` service (no module link exists for analytics_session → website)
- **Best-effort**: errors return empty `{ sessions: [], count: 0 }`

#### `GET /admin/websites/:id/analytics/pages` — Session Entry/Exit Pages (#569 S2)
**Source:** `apps/backend/src/api/admin/websites/[id]/analytics/pages/route.ts:35`

Calls `getSessionPagesWorkflow` (`apps/backend/src/workflows/analytics/reports/get-session-pages.ts:79`):
- Accepts optional `dimension` ("entry_page" | "exit_page"); both are returned by default
- Fetches sessions directly via `analyticsService.listAnalyticsSessions()` with `select: ["visitor_id", "entry_page", "exit_page"]`, `take: 100000`
- Delegates to `computeSessionPageBreakdown()` (`apps/backend/src/workflows/analytics/reports/session-pages-lib.ts:82`): groups sessions by page dimension, sorts by count desc, caps at `limit` (default 20, max 100)
- **Best-effort**: errors return empty zeroed breakdowns

#### `GET /admin/websites/:id/analytics/outbound` — Outbound Links (#569 S5a)
**Source:** `apps/backend/src/api/admin/websites/[id]/analytics/outbound/route.ts:24`

Calls `getOutboundLinksWorkflow` (`apps/backend/src/workflows/analytics/reports/get-outbound-links.ts:55`):
- Filters `analytics_event` rows where `event_name === "link_out"`
- Groups by `metadata.href` (the outbound URL) via `computeOutboundLinks()` (`apps/backend/src/workflows/analytics/reports/outbound-links-lib.ts:65`)

#### `GET /admin/analytics-events/breakdown` — Event Breakdown (#559 slice 3)
**Source:** `apps/backend/src/api/admin/analytics-events/breakdown/route.ts:39`

Calls `getAnalyticsBreakdownWorkflow` (`apps/backend/src/workflows/analytics/reports/get-analytics-breakdown.ts:74`):
- Required `website_id` + `dimension` (one of 15: country, device_type, browser, os, referrer_source, referrer, utm_source/medium/campaign/term/content, pathname, is_404, event_type, event_name)
- Optional composable equality filters on any filterable field (passed as query params)
- Fetches raw events then delegates to `applyEventFilters()` + `computeBreakdown()` in `apps/backend/src/workflows/analytics/reports/breakdown-lib.ts:140,166`
- `computeBreakdown()` groups by dimension value, computes count + unique_visitors + percentage per bucket, caps at `limit` (default 20, max 100)
- Uses `normalizeFieldValue()` (line 122) for canonical grouping: null `referrer_source` → "direct", null `country` → "unknown", `is_404` boolean → "true"/"false", etc.
- Pure framework-free lib, unit-tested in isolation

#### `GET /admin/analytics-events/stats` — Aggregated Stats
**Source:** `apps/backend/src/api/admin/analytics-events/stats/route.ts:60`

Calls `getAnalyticsStatsWorkflow` (`apps/backend/src/workflows/analytics/reports/get-analytics-stats.ts:174`):
- Returns: `overview` (totals), `top_pages` (top 10), `referrer_sources` (top 10 with percentage), `devices`, `browsers`, `operating_systems` (top 10 each)
- All computed in-memory from the fetched event list (no aggregation queries)

#### `GET /admin/analytics-events/timeseries` — Time Series
**Source:** `apps/backend/src/api/admin/analytics-events/timeseries/route.ts:173`

Calls `getAnalyticsTimeseriesWorkflow` (`apps/backend/src/workflows/analytics/reports/get-analytics-timeseries.ts:124`):
- Required `website_id` + date range; optional `interval` ("hour" or "day", default "day")
- Fetches all events in range, groups by rounded timestamp (ISO day or hour key), fills missing intervals with zero data points
- Returns `{ timestamp, pageviews, custom_events, total_events, unique_visitors, unique_sessions }` per bucket

#### `GET /admin/analytics/live` — Real-Time SSE
**Source:** `apps/backend/src/api/admin/analytics/live/route.ts:178`

Server-Sent Events endpoint:
- Registers the response in the in-memory `analyticsConnections` Map (shared with `apps/backend/src/subscribers/analytics-realtime.ts:13`)
- Sends initial `connected` event with live stats computed via `computeLiveStats()` (`apps/backend/src/api/admin/analytics/live/lib.ts:78`):
  - `currentVisitors`: distinct `session_id` within the last 5-minute window
  - `uniqueVisitors`: distinct `visitor_id` in same window
  - `recentEvents`: newest-first, capped at 10
  - `activePages`: visitor's latest page → counted → top 5 by count
- 30-second heartbeat to keep connection alive
- Periodic DB-refreshed snapshot re-pushed every `ANALYTICS_LIVE_REFRESH_MS` (default 15s, min 5s, env-configurable) so multi-instance deployments self-heal
- The `analytics_realtime` subscriber (`apps/backend/src/subscribers/analytics-realtime.ts:15`) listens for `analytics_event.created` events and broadcasts `new_event` SSE messages to all connected clients for that `website_id`

### Public frontend read

#### `GET /web/website/:domain/marketing/metrics`
**Source:** `apps/backend/src/api/web/website/[domain]/marketing/metrics/route.ts:119`

Reads from `analytics_daily_stats` via graph query (the `analytics_daily_stats` entity) — sums `unique_visitors` and `pageviews` across the window for a marketing-site headline.

---

## Gotchas / Invariants

1. **Only AnalyticsEvent has a module link.** `AnalyticsSession` and `AnalyticsDailyStats` carry `website_id` text columns but have no `defineLink` to Website. All session/daily-stats workflows resolve via `container.resolve(ANALYTICS_MODULE)` and query the models directly. Source: `apps/backend/src/links/website-analytics-link.ts:15` — only references `analyticsEvent`, plus the model files' comments at `analytics-session.ts:7` and `analytics-daily-stats.ts:7`.

2. **First-touch UTM attribution on sessions.** `track-analytics-event.ts:228` guard `!(session as any).utm_campaign` means UTM fields are written once on session creation and never overwritten by subsequent events with different UTM values.

3. **Duration is NOT computed in real-time.** Session `duration_seconds` is set to `null` on creation and never updated by the track workflow. It is only populated in rollups (the `aggregate-daily-analytics` job reads session rows but `duration_seconds` stays as stored — the backfill script at `apps/backend/src/scripts/backfill-bounce-rate.ts` suggests this has been a known gap).

4. **Redis buffer is at-most-once.** `drainBuffer()` (`ingest-buffer.ts:144`) uses `RPOP` which removes entries from Redis before they are persisted. A crash between RPOP and the DB write causes data loss. The docblock at line 141 explicitly notes this and mentions an LMOVE-based processing queue as the upgrade path.

5. **Heartbeats ALWAYS bypass the buffer.** `track/route.ts:191` checks `isHeartbeatEvent()` first; heartbeats always take the synchronous write path so the live-visitor count stays real-time regardless of the drain cadence. `ingest-buffer.ts:63` documents this.

6. **Batch drain orderAndDedupeBuffer() sorts ascending by timestamp.** This ensures that when a batch is drained out of arrival order, session entry/exit/bounce computation remains correct. Source: `ingest-buffer.ts:70` docblock + line 87.

7. **Events breakdown is purely in-memory.** `getAnalyticsBreakdownStep` (`get-analytics-breakdown.ts:30`) fetches ALL matching events and delegates to the pure `computeBreakdown()` function. There is no SQL-level GROUP BY — the entire aggregation happens client-side. This has scaling implications for large websites with millions of events.

8. **Daily stats also fetch all events + sessions up to `take: 100000`.** Both `computeDailyStatsForWebsite` and `getWebsiteAnalyticsOverviewStep` hardcode `take: 100_000`. Events/sessions beyond this cap are silently ignored in the aggregation. Source: `compute-daily-stats.ts:72,91` and `get-website-analytics-overview.ts:131`.

9. **Session page breakdown fetches ALL sessions with `take: 100000`.** `get-session-pages.ts:61` — same hardcoded 100k limit.

10. **Live SSE only works within a single instance's push pool.** The `analyticsConnections` in-memory Map (`analytics-realtime.ts:13`) only receives events processed by the same Fargate instance. The periodic DB-refreshed snapshot (`live/route.ts:225`) is the multi-instance self-heal mechanism.

11. **`updateAnalyticsSessions` compensation deletes rather than restores.** The compensation handler in `track-analytics-event.ts:276` calls `analyticsService.deleteAnalyticsSessions(sessionId)` — meaning a failed step 2 after a successful step 1 leaves the event in place but removes the session even if it was an update, not a create.

12. **Events are soft-deleted.** Both `createAnalyticsEventStep` compensation (`create-analytics-event.ts:36`) and `deleteAnalyticsEventWorkflow` (`delete-analytics-event.ts:20`) call `softDeleteAnalyticsEvents` / `deleteAnalyticsEvents`, which the Medusa `MedusaService` implements as soft-deletes (sets `deleted_at`). The indexes in migrations confirm this: `WHERE deleted_at IS NULL` filters.

13. **`country-from-timezone.ts` has curated coverage.** The `TIMEZONE_COUNTRY` map at line 28 covers India (primary), US, Canada, MX, BR, AR, CL, CO, PE, VE, major European, Middle East, South/Central/East/Southeast Asia, Oceania, and Africa. Unknown zones return `null`, gracefully falling through to the GeoIP tier.

---

## Open Questions / (unverified)

- **Session ended_at / duration computation:** I found no workflow that computes `ended_at` or `duration_seconds` for sessions after the fact. The `backfill-bounce-rate.ts` script suggests some backfilling has been necessary, but the normal path for these fields is unclear. They may be left as `null`/`ended_at` indefinite.
- **AnalyticsEvent link is read-only.** The `defineLink` at `apps/backend/src/links/website-analytics-link.ts:25` sets `readOnly: true`. This is by design — the link is for graph queries only, not cross-module writes.
- **Migration counts:** There are many `.snapshot-*` JSON files under `migrations/` suggesting iterative schema changes, but I only read the most recent migration file (`Migration20260619000000.ts`). The full schema evolution is outside scope.
- **The `update-analytics-event.ts` workflow** exists but I did not verify where it is called from (likely the admin CRUD endpoints for editing events).
