# In-house batched analytics ingestion + OpenPanel-style visitor UI

**Status:** design locked 2026-06-20 (Saransh). Supersedes the Cloudflare edge-offload
direction (#344) — see "Decision & why" below. Daemon-ready, sliced.

## Decision & why

We will **keep visitor analytics fully self-hosted on Postgres** and make ingestion
non-blocking **in-house with Medusa's Redis-backed primitives** — *not* via Cloudflare.

Why we abandoned the CF edge path (after building it):
- **CF KV is a buffer, not a store.** It holds an event for ~1 min then drains to
  Postgres and deletes it. It cannot store or query analytics. Postgres was always
  the real store.
- **Medusa's built-in Analytics module doesn't help here.** Its provider interface
  (`AbstractAnalyticsProviderService`) is **write-only** (`track`/`identify`/`shutdown`,
  no read) — a one-way pipe to PostHog/Segment. It can't serve our dashboards.
- **Redis is already wired in prod** (cache-redis, event-bus-redis,
  workflow-engine-redis, locking-redis — all on `REDIS_URL`). The same "buffer the
  firehose, batch-insert" shock-absorber the CF worker provided can be done in-house
  with zero external dependency and **without the 60s live-data lag** CF's cron forced.
- At current volume (~17k lifetime events) none of this is load-driven — it's
  forward-looking hygiene + the UI is the real user value.

**Live data stays real-time (hybrid):** heartbeats (which drive the live-visitor
count + `GET /admin/analytics/live` SSE) keep writing through synchronously; only the
bulk pageview/custom-event firehose is batched.

## Architecture

```
Visitor → POST /web/analytics/track
   ├─ heartbeat event_name?  → write-through (current path, instant) → live count stays real-time
   └─ else (flag ANALYTICS_BATCH_INGEST on) → LPUSH normalized event to Redis buffer → 200 immediately
Scheduled drain job (every ~15–30s, locking-redis guarded)
   → pop up to N → batchTrackAnalyticsEventsWorkflow (dedupe by event_id, sort by ts,
     session entry/exit/bounce correctness) → batch persist to Postgres
   → delete from buffer only after durable persist (at-least-once; event_id idempotent)
Postgres = single source of truth → report workflows → OpenPanel-style admin UI
```

Reuse what slice-1/#547 already built: `api/web/analytics/ingest-batch/lib.ts`
(`normalizeAndDedupeBatch`, `filterAlreadyPersisted`) is pure + tested — share it for
the in-house batch path instead of re-implementing.

### NOT a long-running workflow (important)
This is a **producer/consumer queue**, not a perpetual workflow:
- **Hot path (per visitor hit): NO workflow.** The `/track` route does a plain Redis
  `LPUSH` to `analytics:ingest:buffer` and returns — sub-ms, no workflow engine on the
  request path. (Heartbeats still run the existing synchronous track workflow for live.)
- **Consumer: a normal Medusa scheduled job** (cron, like the existing
  `aggregate-daily-analytics.ts`) that fires every ~15–30s, pops a batch, runs a
  **short-lived** `batchTrackAnalyticsEventsWorkflow` (starts, persists the batch, ends),
  then returns. Each run is bounded by batch size — not a workflow that stays open.
- We deliberately avoid a long-running / durable-wait workflow: those are for awaiting
  external events or human steps, and using one as a standing accumulator would leak
  workflow-engine state and is an anti-pattern here. Redis is the buffer; the job is the
  drain trigger; the workflow is just the (short) persist transaction.
- `locking-redis` guards the drain so overlapping ticks / multiple Fargate instances
  can't double-process the same keys.

## Slices (one PR each, off `main`, daemon-serial)

### Slice 1 — Redis-buffered ingestion on `/web/analytics/track` (backend)
- Behind flag `ANALYTICS_BATCH_INGEST` (default **off** → current synchronous behavior).
- When on: normalize (reuse ingest-batch lib) → push to Redis list `analytics:ingest:buffer`
  → return `{success:true}` without awaiting a DB write.
- **Heartbeats (`event_name === "heartbeat"`) always bypass the buffer** → write-through.
- Generate an `event_id` at ingest when absent (idempotency key for the drain).
- Unit tests: flag gating, heartbeat bypass, buffer payload shape.

### Slice 2 — Drain job + batch-insert workflow (backend)
- New `src/jobs/drain-analytics-buffer.ts` (cron, ~every 15–30s) — mirrors existing
  `aggregate-daily-analytics.ts` job style.
- `locking-redis` guard so multiple Fargate instances don't double-drain.
- New `batchTrackAnalyticsEventsWorkflow` — batch version of `track-analytics-event`:
  dedupe (within-batch + cross-batch via persisted `event_id`), sort ascending by ts
  (session entry/exit/bounce stays correct under batching), batch persist.
- Delete keys from the buffer **only after** persist succeeds (at-least-once).
- Unit tests on the pure batch/dedupe/session-ordering helpers; integration test for
  the drain round-trip.

### Slice 3 — Granular stats query endpoints (backend)
- Breakdown reports by dimension with date-range + filter support:
  `country`, `device_type`, `browser`, `os`, `referrer_source`, `utm_source/medium/campaign`,
  `pathname`, plus `is_404`. Build on existing `reports/get-analytics-stats.ts` +
  `reports/get-analytics-timeseries.ts` workflows.
- Filters compose (e.g. country=IN AND device=mobile, last 7 days).
- Pure aggregation helpers, unit-tested; integration test per dimension.

### Slice 4 — OpenPanel-style visitor analytics UI (admin, Playwright-gated)
- Redesign `src/admin/routes/websites/[id]/analytics/page.tsx`:
  - Overview cards: unique visitors, pageviews, bounce rate, avg session (date-windowed).
  - Time-series chart (visitors/pageviews/sessions) with range picker.
  - Breakdown tables: top pages, referrers, countries, devices, browsers, OS, UTM —
    each consuming slice-3 endpoints.
  - **Filter bar + date-range picker** driving all panels (the "more granular stats" ask).
  - Keep/embed the live section (`live-analytics-panel.tsx`) — real-time, unchanged.
- Medusa-native styling (`--ui-*`/`--elevation-*`), **Skeleton** loaders everywhere,
  `toast` from `@medusajs/ui`.
- Daemon (headless): ship verifiable react-query hooks + a grounded UI spec doc;
  render slice verified with Playwright against local `yarn dev`.

### Slice 5 — Cloudflare teardown — **DONE 2026-06-20**
- Deployed CF resources deleted via the CF API: worker `jyt-analytics-collect` + KV
  namespace `d8adc466…` (both confirmed gone). The worker carried 0 traffic and was
  never in the live path, so removal was safe immediately (no need to gate on 1–2).
- Code removed: `apps/analytics-worker/` (PR `chore/559-remove-cf-analytics-worker`).
- **Kept on purpose:** `/web/analytics/ingest-batch` route + its pure `lib.ts`
  (`normalizeAndDedupeBatch`/`filterAlreadyPersisted`) — it's a harmless authed backend
  endpoint and slice 1/2 reuse the lib. Drop the HTTP route later only if it stays unused.
- #344 parked → effectively retired by this slice.
- *Reversible:* all deleted code is in git history; KV/worker recreatable from it.

### Slice 6 — browser-side country capture (client + backend) — **this release**
Now that the CF edge GeoIP (`request.cf.country`) is gone, capture country from the
**browser** so it doesn't depend solely on server-side GeoIP (which can be wrong behind
the ALB / proxies / VPNs).
- **Client** (`apps/analytics/src/analytics.js`, rebuild `analytics.min.js`): add
  `timezone` (`Intl.DateTimeFormat().resolvedOptions().timeZone`, e.g. `Asia/Kolkata`)
  and `locale` (`navigator.language`) to every event payload. Timezone is the most
  reliable browser country proxy; locale is a weak hint.
- **Backend**: extend `TrackEventSchema` (and the batch schema) with `timezone`,
  `locale`, optional `country`. In `track-analytics-event`, resolve country by
  precedence: **explicit client `country` → `countryFromTimezone(timezone)` →
  server GeoIP(ip) fallback**. Pure `countryFromTimezone()` helper (tz→ISO-3166), unit-tested.
- Backfill not needed — applies to new events; existing rows keep their GeoIP country.
- Lands alongside slice 1 (same ingestion touch-point).

## Storage scaling path (recorded — Postgres now, options later)
Postgres stays the system of record. If event volume ever outgrows it (millions of
rows, slow aggregations), the upgrade order is:
1. **Now → Postgres.** Exact counts, our infra, full control. Fine at current volume.
2. **Later (preferred) → self-hosted ClickHouse** for the *event* store (columnar OLAP),
   Postgres keeps metadata/config. Same query power as OpenPanel, our infra, no sampling.
3. **Optional edge alternative → Cloudflare Workers Analytics Engine** (ClickHouse-style,
   SQL API). We'd **forward/mirror** events to it from our pipeline (a tee in the drain
   step) for edge-served dashboards — NOT make it the system of record. Tradeoffs:
   re-introduces a CF dependency, adaptive **sampling** (estimated counts), limited
   retention, data leaves our infra. Roadmap-only; build only if edge analytics is wanted.

The drain step (slice 2) is the natural tee point: once it persists a batch to Postgres
it could optionally also `writeDataPoint(...)` to Analytics Engine behind a flag — keeping
Postgres authoritative while feeding the edge store. Captured for future-us; not in scope.

## Non-goals / explicitly dropped
- **No "backfill events to CF."** Postgres is the store; historical events already live
  there. No migration needed.
- **No Cloudflare Analytics Engine now.** Recorded as a *future, additive, forward-to*
  option only (see Storage scaling path) — never the system of record, never via KV.
- **No swap to Medusa's Analytics module / PostHog.** It's write-only; would lose our
  dashboards. (Optional future additive feed only if external dashboards are ever wanted.)

## Verify
- Slice 1/2: `pnpm test:integration:http:shared ./integration-tests/http/analytics`;
  flip `ANALYTICS_BATCH_INGEST` in a dev env, fire `/track`, confirm events land via the
  drain (event_id populated) and the live count still updates instantly from heartbeats.
- Slice 3: per-dimension breakdown integration tests.
- Slice 4: Playwright against local admin (`:9000/app`).
