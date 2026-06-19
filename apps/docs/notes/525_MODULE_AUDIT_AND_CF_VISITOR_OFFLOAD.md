# #525 — Key-modules audit + visitor-data Cloudflare offload (build-ready design)

**Status:** analysis chunk (daemon 3/10). No code shipped — this is the build-ready design doc.
**Folds in:** roadmap **#344** (Cloudflare offload for analytics / visitor data).
**Scope:** (1) audit 5 modules (`designs`, `inventory_orders`, `partner`, `raw_material`, `website`) + their list/filter surfaces; (2) map the visitor-data pipeline as-is; (3) design a Cloudflare offload for real-time visitor reporting; (4) prioritized backend + UI improvements.

---

## 1. Module audit (model · list routes · filter gaps)

Legend: ✅ = `q` search supported & correct · ⚠ = gap / asymmetry · — = no surface.

| Module | Model file | Partner-ownership / key enums | Admin list (`q`?) | Partner list (`q`?) | #484 page-vs-set safe? | Gaps |
|---|---|---|---|---|---|---|
| **designs** | `models/design.ts` | `owner_partner_id` (nullable) gates visibility/edit/delete; enums `design_type`,`status`(10),`priority`,`origin_source` | `/admin/designs` ✅ (filters: name,type,status,priority,tags,partner_id,customer_id,dates,`include_partner_owned`) | `/partners/designs` ✅ (`status` exact + `q`) | ✅ full-fetch→`applyDesignListFilters`→paginate (1000 cap) | none |
| **inventory_orders** | `models/order.ts` (+`order-line.ts`) | no partner field on model (partner via link); enums `status`(6); `is_sample` | `/admin/inventory-orders` ✅ (`q`→`id`; status,qty,price,dates,order) | `/partners/inventory-orders` ✅ (`status` + `q`) | ✅ full-fetch→`applyInventoryOrderListFilters`→paginate | none |
| **raw_material** | `models/raw_material.ts` | `material_type` (belongsTo, nullable); enums `unit_of_measure`(7),`status`(4) | via `/admin/inventory-items/raw-materials` ✅ (`filters` obj) | via `/partners/inventory-items/raw-materials` ✅ (`q` only) | ✅ full-fetch→slice | ⚠ partner route exposes **only `q`** (no `status`/`type`), unlike designs/inv-orders which give `status`. Likely intentional (global admin-maintained catalog, not partner-scoped state) — **confirm before "fixing".** |
| **partner** | `models/partner.ts` (+`partner-admin.ts`) | enums `status`,`workspace_type`; storefront/vercel cols; **NO `plan`/`tier` field** (tier lives in `partner-plan` module) | `/admin/partners` ⚠ (field filters name,handle,status,is_verified — **no global `q`**) | — (no GET; `/partners` is POST-create only) | n/a | ⚠ admin list has no `q` fuzzy search (must filter name OR handle separately). Low priority. |
| **website** | `models/website.ts` (+`website-domain`,`page`,`blocks`,`subscription-send-log`) | enums `status`,`analytics_provider`(in_house\|custom\|off); **no visitor counter on model** (decoupled into `analytics` module) | `/admin/websites` ⚠ (name,status,domain substring — **no `q`**) | — | n/a | ⚠ no global `q`. Visitor data intentionally lives in the separate `analytics` module, not on `website`/`page`. |

**Audit takeaways**
- The `/partners/*` list routes for `designs`/`inventory_orders`/`raw_material` are **clean** — the #484 fix (read `q` → in-app pure filter → paginate over the full set, `count = matched`) is correctly applied. No new partner-search gaps found.
- Remaining list-search asymmetries are admin-side and low-impact: `partner` and `website` admin lists lack a global `q` (only field filters). `raw_material` partner route omits `status` — a product call, not a bug.
- **No filter work is required for #525.** The substantive vein is the visitor-data pipeline + Cloudflare offload below.

---

## 2. Visitor-data pipeline as-is (write → store → aggregate → surface)

Module = **`src/modules/analytics/`**, registered as `ANALYTICS_MODULE = "custom_analytics"` (renamed to avoid clashing with Medusa's built-in Analytics). Detailed prior docs: `ANALYTICS_ARCHITECTURE_DECISION.md`, `ANALYTICS_REALTIME.md`, `ANALYTICS_REPORTING_APIS.md`, `ANALYTICS_BACKGROUND_JOBS.md`.

### Write (ingestion)
- **`POST /web/analytics/track`** (public, no auth) — `src/api/web/analytics/track/route.ts`. Zod `TrackEventSchema`. Always returns `200 {success:true}` (even on error, for client safety).
- → `trackAnalyticsEventWorkflow` (`src/workflows/analytics/track-analytics-event.ts`), 2 steps:
  1. `createAnalyticsEventStep`: parse UA→browser/OS/device, derive `referrer_source`, GeoIP→country, INSERT `analytics_event`, emit `analytics_event.created`.
  2. `updateSessionStep`: upsert `analytics_session` (entry/exit page, pageviews++, `is_bounce`, first-touch UTM).

### Store (3 models, `src/modules/analytics/models/`)
- `analytics-event.ts` — **raw events** (pageview/custom_event); high-cardinality; indexes on `(website_id,timestamp)`, `(website_id,pathname,timestamp)`, `(session_id)`, `(visitor_id)`, `(website_id,event_type,timestamp)`. **90-day retention.**
- `analytics-session.ts` — session aggregates (unique `session_id`, pageviews, duration, bounce, first-touch UTM).
- `analytics-daily-stats.ts` — **pre-aggregated daily rollups** per `(website_id,date)` (unique): pageviews, unique_visitors, sessions, bounce_rate, avg_session_duration, top_pages/referrers/countries (json), device/browser/os splits. **Kept indefinitely.**

### Aggregate (scheduled jobs, `src/jobs/`)
- `aggregate-daily-analytics.ts` — `0 1 * * *`; rolls **yesterday's** raw events → upsert `analytics_daily_stats` (logic in `src/modules/analytics/lib/compute-daily-stats.ts`).
- `cleanup-analytics-sessions.ts` — `*/10 * * * *`; closes sessions idle >30 min.
- `archive-old-analytics.ts` — `0 2 * * 0`; deletes raw events >90 days (1K batches).

### Surface (read)
- Real-time: SSE `GET /admin/analytics/live` + subscriber `src/subscribers/analytics-realtime.ts` (in-memory pool keyed by website_id, broadcasts `analytics_event.created`).
- Reporting APIs: `GET /admin/analytics-events/stats`, `.../timeseries`, `.../` (raw list); `GET /admin/websites/[id]/analytics` (overview workflow).
- Stats panels: `GET /web/stats/panels/:id/data` → `resolvePanel` → `visual_flows` operations over the **`analytics_daily_stats`** entity (dateField `date`; see #522). This is the path that was all-time-summing before #543.
- Module link (read-only): `src/links/website-analytics-link.ts` (`website.id ↔ analytics_event.website_id`).

### Today's load profile / pain
- Every visit = ≥1 synchronous Fargate workflow run (event INSERT + session upsert + GeoIP + event emit). This is the write load #344 wants off the main app.
- Raw-event table is the growth driver (90-day window); daily_stats is tiny.
- Real-time "active visitors" depends on the in-memory SSE pool — **does not survive multi-instance / restarts** and won't scale horizontally (each Fargate task has its own pool).

### Cloudflare today
- Used for **image transformation** (`/cdn-cgi/image/`), **R2** media, **Workers AI** (storefront chat). **No analytics/visitor offload exists.** No CF KV, no Workers ingest, no Analytics Engine for traffic.

---

## 3. Cloudflare offload design (real-time visitor reporting — #344)

**Goal:** take per-visit write load off Fargate, make "active visitors / today's count" real-time and multi-instance-safe, keep the existing Medusa stats panels working unchanged.

### Decision: edge ingest + buffered flush (recommended) vs Analytics Engine

| Option | What | Pros | Cons |
|---|---|---|---|
| **A. Worker → KV buffer → batched flush to Medusa (RECOMMENDED)** | A CF Worker terminates `track` at the edge, writes a per-visit record into **KV** (or a Durable Object counter for live count), and periodically POSTs a **batch** to a new authed Medusa ingest endpoint that bulk-inserts `analytics_event`/`analytics_session`. | Zero schema change; existing rollups/panels keep working; Fargate sees ~1 batched request per flush window instead of N per-visit; live count served from edge (DO). | Two write paths to keep in sync; need a batch endpoint + auth + idempotency. |
| **B. Workers Analytics Engine (AE)** | Worker writes datapoints to AE; query via AE SQL API for dashboards. | Fully managed, no DB growth, built for high cardinality. | AE is a **separate query surface** — Medusa stats panels (`analytics_daily_stats`) would need a parallel reader; data no longer in Postgres for joins; 90-day sampling semantics differ. Bigger rewrite. |

**Recommendation: Option A.** It folds into the existing pipeline (panels, rollup job, retention all unchanged) and is the smaller, reversible step. Reserve AE for a later phase only if raw-event volume outgrows Postgres.

### Option A architecture
```
Visitor → analytics.js → POST https://collect.<cf-domain>/track   (Cloudflare Worker, edge)
   ├─ Durable Object (per website_id): increment live-active counter (TTL'd) → real-time count
   ├─ KV / Queue: append normalized event {website_id, pathname, visitor_id, session_id, utm…, ts}
   └─ respond 200 immediately (fire-and-forget, same contract as today)

Worker cron (e.g. every 30–60s) OR Cloudflare Queue consumer
   └─ drain buffer → POST batch → Medusa  POST /web/analytics/ingest-batch  (HMAC-signed, idempotent)
                                            └─ bulk createAnalyticsEvents + session upserts
                                               (reuse track-analytics-event logic, batched)

Unchanged downstream: aggregate-daily-analytics job → analytics_daily_stats → stats panels.
Live dashboard: SSE endpoint reads the DO live count (or DO pushes) instead of in-memory pool → multi-instance safe.
```

### Build slices (each a clean PR)
1. **`POST /web/analytics/ingest-batch`** (new authed Medusa route) — accepts an array of normalized events, HMAC/shared-secret auth (env `ANALYTICS_INGEST_SECRET`), bulk-insert reusing `track-analytics-event` step logic, idempotent on a client-supplied `event_id`. *Backend-only, unit-testable with a pure normalize+dedupe helper. Build this FIRST — it's useful even before the Worker exists and keeps the design reversible.*
2. **CF Worker `collect`** (lives outside apps/backend — new `apps/analytics-worker/` or under `deploy/`) — edge `track` handler, KV/Queue buffer, cron drain → calls slice 1. Wrangler config + `ANALYTICS_INGEST_SECRET`.
3. **Durable Object live counter** + rework `GET /admin/analytics/live` to read the DO (multi-instance-safe active-visitor count) — replaces the in-memory SSE pool dependency.
4. **Client switch**: point `analytics.js` `track` URL at the Worker with a **fallback to the direct Medusa route** (feature-flag `ANALYTICS_EDGE_INGEST`), so rollout is reversible and Worker downtime degrades gracefully.
5. **Volume sizing (do before slice 2)**: per #344 "confirm volume first". ✅ **DONE — see "Volume sizing — RESULTS" below.**

### Volume sizing — RESULTS (2026-06-19, real prod data)

Measured against **prod** (`v3.jaalyantra.com`, admin token from SSM `/jyt/prod/ADMIN_OPENAPI_CATALOG_TOKEN`) via
`GET /admin/websites` (9 sites) → `GET /admin/analytics-events/stats?website_id=<id>&days=30` per site.
Note: `stats.overview.total_events` = **all** ingested events (pageviews **+** custom_events); the ingest-batch
endpoint carries all of them, so size on `total_events`, not pageviews alone.

| Window | Total events | Pageviews | Custom events |
|---|---|---|---|
| Last 30 days (all 9 sites) | **7,457** | 1,909 | 5,548 |

- **Aggregate write rate:** ~7,457 / 30d ≈ **~249 events/day** ≈ ~10/hr ≈ **~0.003 events/sec** average.
- **Busiest single site** (jaalyantra.com): 2,864 events/30d ≈ **~95/day**. Next: cici 1,302, ielo 1,181.
- **Peak headroom:** even a 10× burst day ≈ ~2,500 events/day ≈ ~0.03/sec aggregate. Two sites had <150 events/30d
  (raja-shawls 138, perennial 89) and one essentially zero (woven-futures 4) — long tail is negligible.

**Tier decision → Cloudflare KV, NOT Queues.**
- Cloudflare **Queues** only earn their complexity at sustained ~10–50+ msg/sec (~1M+/day). We're ~4 orders of
  magnitude below that. **KV buffer + cron drain** is the right (and reversible) choice.
- **Flush window:** a `*/1 * * * *` (60s) Worker cron is ample; most flushes carry a handful of events. To avoid
  1,440 mostly-empty POSTs/day, **skip the POST when the buffer is empty** (or widen to every 5 min — `*/5`).
- **Batch cap:** ~500 events/batch is safe and will essentially never be hit at current volume.
- **Growth check:** design still holds at **100× growth** (~25k events/day ≈ 0.3/sec) — stay on KV. Revisit Queues
  (or Workers Analytics Engine, Option B) only if sustained rate crosses ~10 events/sec.

**Implication for the offload's value:** at this volume the win is **edge termination + GeoIP-for-free + not waking
Fargate per request** (1 batched POST/window vs N per-visit), NOT raw scale relief. Keep slice 2 lightweight.

### Watch-outs
- **Keep the response contract identical** (`200 {success:true}` always) so the client never changes behavior on edge errors.
- **Idempotency**: batching + retries means events must dedupe on a stable `event_id` (generate client-side or in the Worker) — otherwise double-counting.
- **GeoIP**: the Worker has `request.cf.country` for free — pass it through so Medusa stops doing GeoIP per event.
- **Session upsert** under batching: order events by `ts` within a batch so `entry_page`/`exit_page`/`is_bounce` stay correct.
- **Don't migrate panels** — the whole point of Option A is that `analytics_daily_stats` and `resolvePanel` are untouched.

---

## 4. Prioritized improvements (backend + UI)

**P0 (the #344 vein, in slice order above)**
1. `ingest-batch` endpoint (backend, unit-testable) — *start here next chunk.*
2. ✅ Volume sizing query (DONE 2026-06-19 — ~249 events/day, 9 sites → **KV not Queues**; see "Volume sizing — RESULTS").
3. CF Worker + buffer + cron drain.
4. DO live counter → multi-instance-safe `/admin/analytics/live`.
5. Client edge switch behind a flag.

**P1 (independent, small)**
- Time-based **partitioning** of `analytics_event` (monthly) — eases the 90-day archive job at volume.
- Add global `q` to `/admin/partners` and `/admin/websites` admin lists (mirror the in-app filter pattern) — minor UX.

**P2 (product calls)**
- `raw_material` partner route: add `status`/`type` filters **only if** partners need to filter the shared catalog (currently `q`-only by design).
- Workers Analytics Engine migration — only if Postgres raw-event volume becomes a problem.

---

## Pointers
- Visitor pipeline files: `src/api/web/analytics/track/route.ts`, `src/workflows/analytics/track-analytics-event.ts`, `src/modules/analytics/{models,service,lib/compute-daily-stats}.ts`, `src/jobs/{aggregate-daily-analytics,cleanup-analytics-sessions,archive-old-analytics}.ts`, `src/subscribers/analytics-realtime.ts`, `src/links/website-analytics-link.ts`.
- Stats-panel read path: `src/modules/stats/resolver.ts` → `src/modules/visual_flows/operations/*` over `analytics_daily_stats` (see #522 / `CODEBASE_MAP.md` Stats section).
- Prior art: `ANALYTICS_ARCHITECTURE_DECISION.md`, `ANALYTICS_REALTIME.md`, `ANALYTICS_REPORTING_APIS.md`, `ANALYTICS_BACKGROUND_JOBS.md`, `CLOUDFLARE_IMAGE_TRANSFORMATION.md` (existing CF integration shape).
</content>
</invoke>
