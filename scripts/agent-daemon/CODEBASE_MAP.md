# Daemon Codebase Map

Durable "where things live + how to add X" index for fresh-context daemon chunks.
**Read this first; jump straight to the files. Don't re-grep what's mapped.** Append concrete
findings (paths + one-line recipes); keep it an INDEX, never code dumps; prune stale entries.

## Test / verify commands
- Integration (HTTP), per-file ONLY: `pnpm test:integration:http:shared -- <spec-name-substring>`
  (never the whole dir — @medusajs/index CREATE INDEX CONCURRENTLY vs TRUNCATE boot deadlock).
- Unit specs under `src/api/**`: `TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest --testPathPattern=<name>` (run from apps/backend).
- UI: drive with `playwright-skill` against live `yarn dev` on :9000 (admin at /app). Throwaway admin user via `cd apps/backend && npx medusa user --email x@jyt.local --password 'Pw123!'`.
- Prod verify: `v3.jaalyantra.com`; admin token = SSM `/jyt/prod/ADMIN_OPENAPI_CATALOG_TOKEN` (Basic auth, region us-east-1).

## Partner API parity (#337 / roadmap #6)
- Partner routes live in `apps/backend/src/api/partners/...` (mirror `apps/backend/src/api/admin/...`).
- **Partner auth is registered centrally** in `apps/backend/src/api/middlewares.ts` — add a matcher block
  `{ matcher: "/partners/...", method, middlewares: [authenticate("partner", ["session","bearer"])] }`
  near the other `/partners/designs/...` matchers. ← this file is the shared-conflict hotspot; STACK series here.
- Recipe for a parity route: copy the admin handler shape, add `assertPartnerOwns<X>` guard (401/403/404),
  and a pure `scope...ToPartner()` filter so other-tenant rows can't leak. `query.graph` field syntax =
  `relation.*` suffix (not `*relation` prefix) on partner routes that bypass validateAndTransformQuery.
- Examples MERGED to main: `partners/designs/[designId]/{revisions (#520), used-in (#524), components (#527)}`.
  PR #528 = `.../tasks/` (read-only GET, branched off main — series base PRs merged so no more stacking).
  Unit specs in `partners/designs/__tests__/`.
  - `.../brief/` (#604 slice C, PR #662) GET/POST/PUT — mirrors admin `api/admin/designs/[id]/brief/`
    (PR #657); `assertPartnerOwnsDesign` + pure `pickDesignBrief`; writes via existing `updateDesignWorkflow`
    (brief cols pass through `updateDesignStep`, NO workflow edit). `cost_currency` only overwritten when sent.
  - `assertPartnerOwnsDesign` throws `NOT_ALLOWED` → **HTTP 400** on owner mismatch (404 only when design absent).

## Migrations (hand-written ALTERs) — class names are GLOBAL
- Medusa tracks executed module migrations by **class name** in a tracking table **shared across modules**.
  Two modules with the same `MigrationYYYYMMDDHHMMSS` → the 2nd to run is SKIPPED ("up-to-date") and its
  columns never land (incl. prod). Bit #348-A partner vs #604-A designs (both `Migration20260622120000`) →
  partner.tax_id never landed → PR #661 renamed partner → `...120001`. RECIPE: when adding an ALTER migration,
  pick a timestamp not already used by ANY module: `grep -rl "class Migration<stamp>" apps/backend/src/modules/*/migrations/`.
- To isolate "migration broken" vs "my code broken" when a test 500s on a missing column:
  `psql -c 'create database tmp'; DATABASE_URL=postgres://postgres@localhost:5432/tmp npx medusa db:migrate`
  then check `information_schema.columns`. Real CLI migrate is the source of truth (not the test runner's DB).
- **Recipe variant — "direct child" reads (tasks):** when the related rows are direct children of the design
  (not a cross-design relation like `component_design`/`revised_from_id`), `assertPartnerOwnsDesign` IS the full
  boundary — NO scope-filter helper needed. The pure helper just normalizes the array
  (`query.graph({fields:["tasks.*"]}).data[0].tasks`); admin reads `tasks[0].tasks` directly → crashes on empty.
- **Own-design MUTATION mirrors** (PR #531 `revise`, PR #532 `tasks` POST): same recipe as reads but a POST.
  `assertPartnerOwnsDesign` is the full boundary IFF the workflow has no external side-effects (product/email/
  assignment) and no assignee/cross-tenant field in the body. Admin design task creation = `createTasksFromTemplatesWorkflow`
  (`workflows/designs/create-tasks-from-templates.ts`); its `result` is `[createTasksStep, taskDataStep, createLinksStep]`
  — `list[0]` has `withTemplates/withParent/withoutTemplates` flags (cast `as any`, complex union type), `list[1]` is
  the task array. Reuse admin's `refetchTask` from `api/admin/designs/[id]/tasks/helpers`. Pure `selectCreatedTaskIds`
  in `.../tasks/select-task-ids.ts`. Validators dup the admin discriminated union (`type: template|task|multiple`,
  NO assignee field — admin JSDoc saying `assigneeId` is stale).
- **BLOCKED: `link-media-folder`** — folders (`modules/media/models/folder.ts`) have NO partner-ownership field and
  there's no partner↔folder link (only `links/person-folder.ts` + `links/design-media-folder-link.ts`). A partner
  mirror would let any partner link another tenant's folder to their design (cross-tenant media leak). Needs a
  folder-ownership model/product decision before building.
- **Clean READ-parity series is DONE** (all admin design GET subroutes mirrored). `segment` turned out to be
  a **POST** fal.ai op, NOT a read → shipped as PR #529 (`partners/designs/[designId]/segment/`, stacked on #528).
- **Recipe variant — "partner AI op" (segment):** partner AI routes are quota-gated, NOT naive admin mirrors.
  Precedent = `partners/ai/describe-image/route.ts` (POST) + `partners/ai/usage/route.ts` (GET). Quota lives in
  `modules/ai_usage/service.ts` → `MONTHLY_QUOTA` (just add a key, e.g. `image_segment: 10`; NO migration — the
  `operation` column is a free string). Pattern: `assertPartnerOwnsDesign` → `aiUsage.checkQuota(partnerId,op)`
  → 402 `{upgrade_required}` on exhaustion → `recordUsage` BEFORE the expensive call → call fal. Keep fal
  input-parse + result-extract as PURE helpers (`segment/segment-image.ts`) for unit tests (no network).
  fal-credentials helper: `src/mastra/services/fal-credentials#resolveFalCredentials(scope)`.
- **Both admin design AI POST ops now mirrored:** `segment` (BiRefNet bg-removal, PR #529) +
  `segment/depth` (MiDaS depth+normal maps, PR #530, `quota=image_depth`, helpers `depth-image.ts`/`validators.ts`,
  fal model `fal-ai/image-preprocessors/midas`). ⚠ exact-path matcher `/...segment` does NOT cover `/...segment/depth`
  → each needs its OWN middlewares matcher block.
- **`revise` mirrored (PR #531, stacked on #530)** — `partners/designs/[designId]/revise/` POST. The ONE clean
  mutating slice: own-design fork, `reviseDesignWorkflow` re-links the partner to the new revision (verified in
  `workflows/designs/revise-design.ts` `linkPartnersToNewDesignStep` ~L314/L384) so it stays partner-owned, no
  external side-effects. Pattern for "own-design mutation": `assertPartnerOwnsDesign` is the full boundary +
  pure pre-check helper (`revise/revisable.ts#isDesignRevisable`, mirrors workflow `REVISABLE_STATUSES`) for a
  friendly 422. Validators mirror admin's exactly.
- Admin design subroutes still NOT mirrored = **decision-bearing**, analyzed in
  `apps/docs/notes/337_PARTNER_DESIGN_MUTATION_PARITY.md` (per-route decision + recommendation + build order):
  `link-media-folder` (near-clean; needs a partner folder-ownership guard) → `approve` (creates product; needs
  self-approve gating + #485 currency/sales-channel wiring) → `notify-customer` (defer to #332 + partner
  storefront URL) → `cancel-partner-assignment` (reframe as "decline assignment") → `partner` (keep admin-only,
  no mirror). **Clean read+AI+own-mutation parity is now DONE; the rest need a product call.**

## Production runs (parent/child quantities) (#498)
- Model `src/modules/production_runs/models/production-run.ts`: `quantity` (float, set at
  create from payload, NOT from tasks), `parent_run_id` (nullable), `design_id`, `status`,
  `produced_quantity`/`rejected_quantity`.
- A design's runs = 1 PARENT + 1 CHILD per partner assignment; children share the parent's
  `design_id` (`approveProductionRunWorkflow` sets `parent_run_id`+`design_id`), and parent
  `quantity` already = Σchildren. So `GET /admin/production-runs?design_id=` (fields `["*"]`)
  returns BOTH → naive `runs.reduce(+quantity)` double-counts. **To sum a design's runs, sum
  LEAF runs only** (runs not referenced as any other run's `parent_run_id`). Helper:
  `src/admin/widgets/production-run-totals.ts#{summarizeProductionRunTotals,leafProductionRuns}` (#498/PR #595).
- Product detail "Designs" widget = `src/admin/widgets/product-designs.tsx`
  (`DesignAdminProductionRunsSection`); run list hook `src/admin/hooks/api/production-runs.ts#useProductionRuns`.
- Admin unit specs: `TEST_TYPE=unit ... jest --testPathPattern=<name>`; pattern
  `**/src/**/__tests__/**/*.unit.spec.ts`. Existing tsc baseline = **70** errors (0-new gate).

## Ops maintenance-jobs registry (#457 / #485 / #508 — "Data Plumbing")
- Registry: `apps/backend/src/api/admin/ops/maintenance-jobs/registry.ts` — add job object + append to the
  `MAINTENANCE_JOBS` array (shared-conflict hotspot; union on conflict). Pure helpers exported for unit tests.
  Each newer job gets its OWN `__tests__/<job-id>.unit.spec.ts` (NOT the big `registry.unit.spec.ts`).
  **Link-repair jobs are a clean precedent** (`repair-partner-region-links` PR #514, `repair-inventory-raw-material-links`
  PR #533): enumerate pivot rows via `query.graph({entity: "<link_entity>", fields: [fk cols]})`, fetch which referenced
  entities still exist (module list / query.graph), flag orphans, `remoteLink.dismiss({ [ModuleKey]: {<fk>: id}, ... })`.
  Orphan detection does NOT rely on join semantics. inventory↔raw_material link: entity `inventory_item_raw_materials`,
  FKs `inventory_item_id`+`raw_materials_id`, dismiss `{ [Modules.INVENTORY]:{inventory_item_id}, [RAW_MATERIAL_MODULE]:{raw_materials_id} }`
  (RAW_MATERIAL_MODULE="raw_materials"); link def `src/links/raw-material-data-inventory.ts`. Composite-PK links → no exact dups.
  Remaining ranked candidates (DATA_PLUMBING_V2.md §d) #4 owner-partner-id + #6 sales-channel-store are DECISION-BEARING.
- Routes: `[id]/run/route.ts` (run one), `runs/route.ts` (list), `runs/[id]/route.ts` (one run),
  `batches/route.ts` (POST run-batch + GET list), `batches/[id]/route.ts` (batch detail). Query schemas in
  `validators.ts`. Batch model: `src/modules/ops_audit/models/ops-maintenance-{run,batch}.ts`.
- Admin UI: `src/admin/routes/settings/ops-data-plumbing/{page.tsx (root DataTable + Run drawer + filters),
  [id]/page.tsx (run detail), components.tsx (RunBadge/ChangesTable/BatchDetailView)}`; hooks in
  `src/admin/hooks/api/ops-maintenance.ts`.

## Admin UI conventions (Medusa admin extensions, apps/backend/src/admin)
- Settings list page = `routes/settings/<x>/page.tsx`; detail route = `routes/settings/<x>/[id]/page.tsx`;
  row → `navigate("/settings/<x>/:id")` (mirror energy-rates / external-platforms).
- DataTable: `useDataTable({columns, data, filters, pagination, filtering, onRowClick})`;
  `<DataTable.Table emptyState={{empty:{heading,description}}}/>`. Filters via
  `createDataTableFilterHelper<{...}>()` + `DataTableFilteringState` → translate to API query params.
  The DataTable renders the filter funnel itself when `filters` is set — do NOT add a second `<DataTable.FilterMenu>`.
- `toast` from `@medusajs/ui` (NOT sonner). Skeletons for loading. `--ui-*`/`--elevation-*` tokens, no hardcoded colors.

## Module / service / model
- Module dir `src/modules/<m>/`: `index.ts` (Module()), `models/<m>.ts` (model.define), `service.ts`
  (extends MedusaService({...}) — auto-gens create/list/listAndCount/retrieve<Model>), `migrations/`.
- Migrations: hand-write `add column if not exists` ALTERs; never edit an existing `create table if not exists`
  (won't land on existing DBs). `medusa db:generate <module>` runs without a live DB (diffs models vs snapshot).
- `container.resolve(...)` → annotate `const x: any =` (TS18046 on clean CI build).

## Two config files
- Prod runs `medusa-config.prod.ts` (Dockerfile cp-overwrites base) — prod-only module/Redis wiring goes there.

## Partner billing / money subsystem (#336, #4)
- **Partner↔order join:** `src/links/partner-order.ts` (D3 M:N, #342) — authoritative "which partner owes for this order".
- **Order accrual hook:** `src/subscribers/order-placed.ts` (already resolves partner+total+creates run). `order-canceled.ts`/`order-fullfilled.ts` for compensation. NO `payment.captured` subscriber exists.
- **Money modules (REPORTING only — no fee/commission/payout model exists):** `modules/payment_reports`, `modules/payment_submissions`, `modules/internal_payments`, `modules/partner-payment-config` (per-partner config PRECEDENT to mirror for fee-rate), `modules/payu-payment`.
- **Partner model** `modules/partner/models/partner.ts` has NO rate/fee field — use a sibling config model, don't bloat partner.
- **Billing read routes:** `api/admin/payment_reports/by-partner/route.ts` (per-partner rollup envelope to mirror), `api/admin/payments/partners/[id]/`, `api/partners/[id]/payments/`.
- **To build #336:** follow `apps/docs/notes/336_PARTNER_TRANSACTION_FEE_BILLING.md` 6-slice plan. Decision LOCKED (flat 2% commission, `PLATFORM_TX_FEE_BPS=200`, accrue at order.placed partner-only, waive on cancel). **Slice 0 DONE → `modules/partner_billing/` (model `partner_fee`, service `findFeeForOrder`, pure `lib/compute-fee.ts` = `computeFee`/`parsePlatformFeeBps`); PR #535.** New-module reg added to BOTH `medusa-config.ts` + `medusa-config.prod.ts`. **Slice 1 DONE → `modules/partner_billing/lib/resolve-fee-rate.ts` = pure `pickFeeRate(overrideBps,defaultBps)` (override>default precedence) + async `resolvePartnerFeeRate(container,{partnerId})` (reads env via `parsePlatformFeeBps`; override lookup is a deferred no-op stub; never-throws); PR #536 STACKED on #535.** **Slice 2 DONE → sibling subscriber `src/subscribers/order-placed-accrue-fee.ts` (kept SEPARATE from order-placed.ts); PR #537 STACKED on #536.** Gates on link via `query.graph({entity: partnerOrderLink.entryPoint, fields:["partner_id"], filters:{order_id}})` (import `partnerOrderLink from "../links/partner-order"`); no row → retail → skip. Idempotent via `billing.findFeeForOrder`. Reads order `total`+`currency_code`. `resolvePartnerFeeRate`→`computeFee`→`createPartnerFees([{...status:"accrued", accrued_at:new Date()}])`. Best-effort try/catch. Test: `integration-tests/http/order-placed-partner-fee.spec.ts` (mirror `order-placed-production-runs.spec.ts`: create partner via `/partners`, order via `orderService.createOrders`, link via `remoteLink.create([{[PARTNER_MODULE]:{partner_id},[Modules.ORDER]:{order_id},data:{...}}])`, invoke handler directly). **Slice 3 DONE → sibling subscriber `src/subscribers/order-canceled-reverse-fee.ts` on `order.canceled` (kept SEPARATE from order-canceled.ts) + new service method `PartnerBillingService.reverseFeeForOrder(orderId, reason)`; PR #538 STACKED on #537.** Service method is idempotent+best-effort: null no-op for retail (no fee) AND already-terminal fees (only `accrued`→`reversed`, stamps `reversed_at`/`reversed_reason` in metadata). Used `reversed` not `waived`. Test `integration-tests/http/order-canceled-partner-fee.spec.ts` (accrue via Slice2 handler then cancel→reversed, double-cancel no-op, retail no-op). **Slice 4 DONE → read API `src/api/admin/partners/[id]/fees/route.ts` + partner mirror `src/api/partners/[id]/fees/route.ts` (auth via `getPartnerFromAuthContext`); pure `modules/partner_billing/lib/summarize-fees.ts`=`summarizePartnerFees` (total vs net=accrued|invoiced, by_status, by_currency); resolve `PARTNER_BILLING_MODULE`, `listPartnerFees({partner_id[,status]})`, roll-up over FULL set not page; PR #539 STACKED on #538.** **Slice 5 DONE (LAST) → ops backfill job `backfill-partner-order-fees` appended to `src/api/admin/ops/maintenance-jobs/registry.ts` + MAINTENANCE_JOBS array; PR #542 STACKED on #539.** Per partner: read partner↔order link → orders, accrue one `partner_fee` per eligible order via `resolvePartnerFeeRate`→`computeFee` in order's `currency_code`; idempotent (skip existing `findFeeForOrder`) + skip `canceled` orders (subscriber would have accrued+reversed=net zero). Pure `shouldBackfillOrderFee(existingFee,orderStatus)`/`summarizePartnerFeeBackfill(...)` + `MAX_PARTNER_FEE_BACKFILL_SCAN=5000`; 10 unit. Mirrors `backfillPartnerOrderCurrencyJob` exactly. **#336 now feature-complete (Slices 0-5 all built) → drain merge stack parent-first #535→#536→#537→#538→#539→#542.**
- **bigNumber migration recipe:** a `model.bigNumber()` col `X` → migration needs `"X" numeric not null` + `"raw_X" jsonb not null` sidecar. `model.enum([...])` → `"X" text check ("X" in ('a','b')) not null default '…'`. New table = `create table if not exists` is SAFE (hazard is only column-adds to an existing create-if-not-exists). Mirror `modules/internal_payments/migrations/Migration20250105072006.ts`.
- **New module checklist:** `modules/<m>/{index.ts Module(),service.ts MedusaService,models/<m>.ts,migrations/MigrationYYYYMMDDHHMMSS.ts}` + register resolve path in `medusa-config.ts` AND `medusa-config.prod.ts` (NOT `.dev.ts` — partner-payment-config precedent skips dev). No `.snapshot-*.json` needed for a hand-written migration (snapshots are only for `db:generate` diffing).
- **Data-plumbing dead-ends (do NOT build):** #4 `backfill-design-owner-partner-id` is a NON-job — `design.owner_partner_id IS NULL` already MEANS admin/canonical (set only at create from auth, never cleared), so there is nothing safe to backfill. #6 `relink-orphan-sales-channel-store` needs canonical-shape decision.

## Stats dashboards / panels (#522, #341)
- **Compute pipeline:** public `GET /web/stats/panels/[id]/data/route.ts` + admin `.../admin/stats/panels/[id]/data/route.ts` + preview `.../admin/stats/panels/preview/route.ts` → all call `resolvePanel(container, panel)` in `src/modules/stats/resolver.ts` → dispatches to the visual-flows `operationRegistry` by `panel.operation_type`.
- **Panel operations live in `src/modules/visual_flows/operations/`** (NOT in stats module): `aggregate-data.ts` (count/sum/avg/min/max/count_distinct metric), `time-series.ts` (day/week/month buckets), `cart-recovery-stats.ts`, `aggregate-product-analytics.ts`. Each exports an `OperationDefinition` with `execute(options, ctx)`; registered in `operations/index.ts`/`types.ts` `operationRegistry`.
- **Date-window contract:** `time_series` has `range: { last_days } | { from, to }` (UTC-day-aligned). `aggregate_data` NOW also has `range` + `dateField` (default created_at) → pure exported `resolveRangeWindow(range, now)` (#522 PR #543). To bound any metric to a rolling window, set `dateField` + `range` in its `operation_options`. Without `range`, aggregate_data is all-time.
- **Seeds:** `src/scripts/seed-stats-dashboards.ts` (panel definitions; analytics entity = `analytics_daily_stats`, dateField `date`) + `seed-cart-recovery-dashboard.ts`. ⚠️ seed SKIPS existing dashboards (panels untouched) — editing a panel's operation_options here does NOT retro-patch live DB rows; patch via admin panel editor / PUT or re-seed fresh dashboard.
- **To fix a "shows wrong window" metric panel:** add `dateField`+`range` to its operation_options (code path now supports it) AND patch the live panel row's operation_options (seed won't). **The live-row patch is now an ops job: `backfill-stats-panel-window` (#552)** in the maintenance-jobs registry — pure `diffStatsPanelWindow` adds `dateField`+`range:{last_days}` to `aggregate_data` panels MISSING a range (idempotent), scan-filters on `aggregate.field` (default unique_visitors) or `panel_id` for one panel. Stats service auto-methods: `listAndCountStatsPanels`/`updateStatsPanels` (model `stats_panel`, `STATS_MODULE="stats"` from `src/modules/stats`).

## #541 / partner billing UI (chunk 2/10)
- Admin partner DETAIL page: `src/admin/routes/partners/[id]/page.tsx` (TwoColumnPage; sections in
  `src/admin/components/partners/*-section.tsx`; sidebar = where partner-scoped cards go).
- Partner-fee ledger UI: `src/admin/components/partners/partner-transaction-fees-section.tsx`
  consumes `usePartnerFees` (in `src/admin/hooks/api/partners-admin.ts`) → GET `/admin/partners/:id/fees` (#539).
  To add a partner-detail card: write a `Partner<X>Section({partnerId})`, add a hook in partners-admin.ts, import+place in page.tsx.
- partner_fee read API: `src/api/admin/partners/[id]/fees/route.ts`; rollup `src/modules/partner_billing/lib/summarize-fees.ts`; model `src/modules/partner_billing/models/partner-fee.ts` (has order_id, status enum, bigNumber money).
- Admin money fmt pattern: `Intl.NumberFormat("en-IN",{style:"currency",currency})` (see partner-subscription-section.tsx).
- Playwright UI verify recipe: Node playwright at `~/.claude/skills/skills/playwright-skill/node_modules/playwright` (import index.mjs from a /tmp .mjs); admin at `:9000/app` (login `/app/login`, inputs name=email/password); throwaway user via `npx medusa user -e .. -p ..` + `POST /auth/user/emailpass`. If a merged module's table is missing locally → `cd apps/backend && npx medusa db:migrate`. Seed/clean rows via `npx medusa exec` resolving the module service.

## Visitor analytics pipeline (#525 / #344)
- **Module** `src/modules/analytics/` registered as `ANALYTICS_MODULE="custom_analytics"` (renamed to dodge Medusa's built-in Analytics). Models: `analytics-event.ts` (raw, 90-day retention, heavily indexed on website_id+timestamp/pathname/etc), `analytics-session.ts` (session upsert), `analytics-daily-stats.ts` (per (website_id,date) rollup — the entity stats panels read).
- **Write:** `POST /web/analytics/track` (`src/api/web/analytics/track/route.ts`, public, ALWAYS returns 200) → `src/workflows/analytics/track-analytics-event.ts` (createEvent step parses UA/referrer/GeoIP + emits `analytics_event.created`; updateSession step upserts).
- **Rollup jobs** `src/jobs/`: `aggregate-daily-analytics.ts` (`0 1 * * *`, logic in `src/modules/analytics/lib/compute-daily-stats.ts`), `cleanup-analytics-sessions.ts` (`*/10`), `archive-old-analytics.ts` (`0 2 * * 0`, deletes raw >90d).
- **Read:** SSE `GET /admin/analytics/live` (`src/api/admin/analytics/live/{route.ts,lib.ts,__tests__}`) + `src/subscribers/analytics-realtime.ts` (in-memory push pool); reporting `GET /admin/analytics-events/{stats,timeseries,breakdown,}`; `GET /admin/websites/[id]/analytics`.
- **Granular breakdown (#559 slice 3, PR #562 OPEN):** `GET /admin/analytics-events/breakdown?website_id=&dimension=&[days|start_date&end_date]&limit=&<field>=<val>` — single-dim breakdown over 15 dims (country/device_type/browser/os/referrer_source/`referrer`[full URL, #569 S6 PR #573, null→"direct"]/utm_*/pathname/is_404/event_type/event_name) + composable AND equality filters (any filterable field as a query key; null rows match canonical labels). Route `src/api/admin/analytics-events/breakdown/route.ts` → workflow `src/workflows/analytics/reports/get-analytics-breakdown.ts` → PURE helpers `src/workflows/analytics/reports/breakdown-lib.ts` (`normalizeFieldValue`/`applyEventFilters`/`computeBreakdown`/`BREAKDOWN_DIMENSIONS`/`isBreakdownDimension`). 18 unit (`reports/__tests__/breakdown-lib.unit.spec.ts`) + 6 integration (`integration-tests/http/analytics/analytics-breakdown.spec.ts`). **To add a new breakdown dimension or filter: add the key to `BREAKDOWN_DIMENSIONS` + the field to `AnalyticsEventRow` + the workflow's `select[]` (+ optional `NULL_LABELS` entry for a custom empty-value label) + the admin-mirror `src/admin/hooks/api/analytics-breakdown-query.ts` (BreakdownDimension union AND BREAKDOWN_DIMENSIONS array); helper/route validation pick it up automatically (route has no hardcoded enum).** Fetch-then-aggregate mirrors `get-analytics-stats.ts`. UI consumer = `src/admin/components/websites/live-analytics-panel.tsx` (EventSource; handles `type:'connected'`=full snapshot, `type:'new_event'`=prepend+recompute). Panels read `analytics_daily_stats` via resolvePanel (see Stats section / #522). Link: `src/links/website-analytics-link.ts`.
- **In-house Redis ingestion (#559 slices 1-2, PR #561 OPEN):** producer `LPUSH` in `track/route.ts` behind env `ANALYTICS_BATCH_INGEST` (default off; heartbeats stay synchronous); buffer lib `src/modules/analytics/lib/ingest-buffer.ts` (`BufferedAnalyticsEvent` type, `pushBufferedEvent`/`drainBuffer`/`orderAndDedupeBuffer`/`getIngestRedis`/`isBatchIngestEnabled`/`isHeartbeatEvent`); consumer cron `src/jobs/drain-analytics-buffer.ts` (RPOP→`trackAnalyticsEventWorkflow` per event, locking-redis guarded). **To add a field to a tracked event end-to-end: TrackEventSchema (track/route.ts) → BufferedAnalyticsEvent + route's pushBufferedEvent payload → drain job's workflow input → TrackAnalyticsEventInput (track-analytics-event.ts).**
- **Browser country capture (#559 slice 6, PR #563 OPEN, stacked on #561):** CF edge GeoIP retired → derive country from browser IANA timezone. PURE `src/modules/analytics/lib/country-from-timezone.ts` (`countryFromTimezone(tz)` curated `TIMEZONE_COUNTRY` map→ISO alpha-2, `null`→GeoIP fallback; `resolveEventCountry({clientCountry,timezone,ipCountry})` precedence client→tz→ip) — 11 unit. Workflow event+session steps both call `resolveEventCountry`; locale→`metadata.locale` (events immutable, no migration). Client `apps/analytics/src/analytics.js` sends `timezone`(Intl)+`locale`. 4 integration `integration-tests/http/analytics/analytics-country-capture.spec.ts`. ⚠ `apps/analytics/dist/` GITIGNORED — `analytics.min.js` is CDN build artifact (`node scripts/build.js`, terser); never commit it.
- **Website overview endpoint (#569):** `GET /admin/websites/[id]/analytics` route `src/api/admin/websites/[id]/analytics/route.ts` → workflow `src/workflows/analytics/get-website-analytics-overview.ts` (`getWebsiteAnalyticsOverviewWorkflow`; fetches events via website→analytics_event link with query.graph, filters in-memory by date/utm/pathname/qr; returns `{website, stats, recent_events}`). **NO website→analytics_session link exists** — for session data resolve `ANALYTICS_MODULE` (`custom_analytics`) + `analyticsService.listAnalyticsSessions({website_id, started_at:{$gte,$lte}}, {select,take})` (mirrors ad-planning `bulk-resolve-attributions.ts`).
- **Overview session metrics (#569 S1, PR #570 OPEN):** `stats` now also has `total_sessions/bounce_rate/avg_session_duration/pages_per_session/views_per_visitor`. PURE `src/workflows/analytics/session-metrics-lib.ts` `computeSessionMetrics(rows)` (bounce_rate=bounced/total 4dp; avg_session_duration over duration>0 only; pages_per_session=mean pV 2dp; views_per_visitor=ΣpV/uniqueVisitors 2dp). Workflow session fetch is best-effort try/catch→zeroed. 9 unit `__tests__/session-metrics-lib.unit.spec.ts` + 2 integration `integration-tests/http/analytics/website-overview-metrics.spec.ts`. **To add an overview engagement metric: extend computeSessionMetrics + workflow `stats` literal + `WebsiteAnalyticsOverview.stats` type.** **Edge-coverage convention (#594, PR #598):** analytics `*-lib.ts` helpers already have happy-path `*.unit.spec.ts`; deepen branch coverage in an additive sibling `*.edge.unit.spec.ts` (`session-metrics-lib.edge.unit.spec.ts`, `partner-digest-email-lib.edge.unit.spec.ts`) — zero conflict w/ the happy-path spec. Run per-file: `cd apps/backend && TEST_TYPE=unit NODE_OPTIONS="--experimental-vm-modules" npx jest --testPathPattern="<name>.edge"`.
- **Session entry/exit pages (#569 S2, PR #571 OPEN):** `GET /admin/websites/[id]/analytics/pages?dimension=entry_page|exit_page&days|start_date&end_date&limit` (route `src/api/admin/websites/[id]/analytics/pages/route.ts`, needs 6 `../` to reach workflows). Ranked session breakdown by entry/exit page — omit `dimension`→returns BOTH under `pages.{entry_page,exit_page}`, 400 on unknown. PURE `src/workflows/analytics/reports/session-pages-lib.ts` `computeSessionPageBreakdown(sessions,dim,limit)` (envelope mirrors `breakdown-lib` `BreakdownResult` but `total_sessions` not `total_events`; null/empty page→`(none)`; sort count-desc then value-asc; clamp limit [1,100]) + workflow `reports/get-session-pages.ts` (resolves `custom_analytics`+`listAnalyticsSessions({website_id,started_at:{$gte,$lte}})`, best-effort try/catch→empty; computes requested `dimensions[]`). 10 unit `reports/__tests__/session-pages-lib.unit.spec.ts` + 4 integration `integration-tests/http/analytics/website-session-pages.spec.ts`. **To add a session-based ranked breakdown dimension: add to `SESSION_PAGE_DIMENSIONS` + `SessionPageRow` + workflow `select[]`.**
- **Outbound links (#569 S5a, PR #572 OPEN):** `GET /admin/websites/[id]/analytics/outbound?days|start_date&end_date&limit` (route `src/api/admin/websites/[id]/analytics/outbound/route.ts`, 6 `../`). Ranks `link_out` custom events by `metadata.href`. Envelope `{total_events,total_unique_visitors,results:[{value,count,unique_visitors,percentage}]}`; null/empty href→`(none)`; sort count-desc then value-asc; limit clamp `Math.floor(n)||DEFAULT` (so **limit=0→default 20**, negatives→1). PURE `src/workflows/analytics/reports/outbound-links-lib.ts` `computeOutboundLinks/extractHref` + workflow `reports/get-outbound-links.ts` (`listAndCountAnalyticsEvents({website_id,event_name:"link_out",timestamp:{$gte,$lte}})` select `["visitor_id","metadata"]`). **Client** `apps/analytics/src/analytics.js` `setupOutboundTracking` emits `link_out` w/ `metadata.href`=resolved `url.href` (was unused `outbound_click`/`{url}`). 13 unit `reports/__tests__/outbound-links-lib.unit.spec.ts` + 3 integration `integration-tests/http/analytics/website-outbound-links.spec.ts`. **To aggregate a custom event by a metadata key: filter `event_name` in the listAndCount filters, select `["visitor_id","metadata"]`, group in a pure lib.**
- **Breakdown UI hooks (#559 slice 4, PR #564 OPEN, render slice DEFERRED):** admin react-query consumer of the slice-3 endpoint. PURE framework-free `src/admin/hooks/api/analytics-breakdown-query.ts` (`buildBreakdownQuery(params)` query-string builder — days wins over start/end, drops blank/unknown filters, coerces to string; `BreakdownDimension`/`BREAKDOWN_DIMENSIONS`/`FILTERABLE_FIELDS`/`BreakdownBucket`/`BreakdownResult`/`AnalyticsBreakdownResponse`/`BreakdownQueryParams`/`isBreakdownDimension` — typed MIRROR of server `breakdown-lib.ts`). Hook `useAnalyticsBreakdown(params, opts?)` added to `src/admin/hooks/api/analytics.ts` (existing analytics hooks file: `useWebsiteAnalytics`/`useAnalyticsStats`/`useAnalyticsTimeseries`/`useAnalyticsEvents`). 12 unit `src/admin/hooks/api/__tests__/analytics-breakdown-query.unit.spec.ts` (`TEST_TYPE=unit`). Spec doc `apps/docs/notes/559_ANALYTICS_BREAKDOWN_UI_SPEC.md`. **Render slice = `routes/websites/[id]/analytics/page.tsx` → `components/websites/website-analytics-modal.tsx` (655L, recharts + @medusajs/ui); Playwright-gated, headless daemon can't verify.** ⚠ admin dir is tsconfig-excluded from `medusa build` — verify pure admin helpers standalone via `npx tsc --noEmit --skipLibCheck --strict <file>`; admin unit-test precedent = `routes/messaging/components/__tests__/extract-amount.unit.spec.ts`.
- **Live multi-instance fix (#344 slice 3 lightweight, PR #551, OPEN):** the in-memory push pool only relays events processed by the SAME instance → count drifts on multi-instance. Route now runs a periodic **DB-poll refresh** (`resolveLiveRefreshMs()`, env `ANALYTICS_LIVE_REFRESH_MS`, default 15s/5s-floor) re-pushing an authoritative DB snapshot as `connected` (UI self-heals, no UI change). Pure aggregation extracted to `live/lib.ts` `computeLiveStats(events)` (distinct sessions/visitors, latest-page-per-visitor→top5, newest-first 10) — unit-tested. SSE endpoints aren't HTTP-integration-testable (long-lived+timers) → unit-test the pure helper. To change the live snapshot shape, edit `computeLiveStats`, not the route.
- **CF offload (#344): slice 1 BUILT (PR #547, OPEN).** Authed bulk `POST /web/analytics/ingest-batch` (`src/api/web/analytics/ingest-batch/{route.ts,lib.ts,__tests__/lib.unit.spec.ts}`, `AUTHENTICATE=false`, gated by env `ANALYTICS_INGEST_SECRET` — `x-analytics-secret` shared OR `x-analytics-signature: sha256=` HMAC over raw body). Pure helpers `verifyIngestAuth`/`normalizeAndDedupeBatch`/`filterAlreadyPersisted`. Idempotency = new nullable indexed `analytics_event.event_id` col (migration `Migration20260619000000.ts`, ALTER add-col-if-not-exists) + cross-batch skip. Reuses `trackAnalyticsEventWorkflow` per event (now takes optional `client_event_id`→persisted, `country`→edge cf precedence over GeoIP). **To add idempotency/edge fields to a tracked event: extend `TrackAnalyticsEventInput` in track-analytics-event.ts — NB `event_id` there already = created-event DB id, use a different name.** Slices 2-4 (Worker/DO/client-switch) NOT built. Design: `apps/docs/notes/525_MODULE_AUDIT_AND_CF_VISITOR_OFFLOAD.md`.
- **List-route audit (#525):** partner list routes for designs/inventory_orders/raw_material are CLEAN (full-fetch→in-app filter→paginate, count=matched). `/admin/partners` + `/admin/websites` lack global `q` (field-filters only). raw_material partner route = `q`-only by design (shared catalog).

## #521 abandoned-cart recovery URL (chunk 4)
- Admin detail API: `apps/backend/src/api/admin/abandoned-carts/[id]/route.ts` (builds recovery_url, returns `partner` block). List route + validators in same dir.
- Admin UI: `apps/backend/src/admin/routes/abandoned-carts/{page.tsx,[id]/page.tsx}`; hook types `apps/backend/src/admin/hooks/api/abandoned-carts.ts` (`AbandonedCartDetail`).
- Recovery-link convention: `<base>/checkout/cart/<cartId>`; storefront route at `apps/storefront/src/app/[countryCode]/(checkout)/checkout/cart/[cartId]/route.ts` (cookie+redirect). storefront-starter (submodule) lacks it.
- To resolve a cart's owning partner storefront: `resolvePartnerStorefrontForSalesChannel(query, sales_channel_id)` in `workflows/google_merchant/steps/resolve-partner-landing-base.ts` (sibling to #377's `resolvePartnerLandingBase`). Reuse `partnerBaseFromRecord`. Partner model: `name`,`handle`,`storefront_domain`,`metadata.custom_domain/website_domain` (`src/modules/partner/models/partner.ts`).
- **#449 (PR #616):** visual-flow op `resolve_cart_recovery_urls` (`src/modules/visual_flows/operations/resolve-cart-recovery-urls.ts`) enriches discovered carts with per-partner recovery links (wraps the resolver above, env fallback, per-channel cache). Pure `buildRecoveryUrls`/`summarizeRecoveryUrlRun`. The legacy global `STORE_URL` link lives in seeded `execute_code` (`src/scripts/seed-cart-recovery-flow.ts:168`); prod flow is admin-authored, so wiring the op in is an ops tail. **Recipe — add a visual-flow op:** new `operations/<name>.ts` exporting `OperationDefinition` (interpolate `{{ }}` array opts via `interpolateVariables(opts, context.dataChain)` BEFORE `Array.isArray`; resolve services via `context.container.resolve(ContainerRegistrationKeys.QUERY)`) + register in `operations/index.ts` (3 spots: re-export ~L24, import ~L63, `registerBuiltInOperations()` call ~L104). Unit-test by calling `op.execute(opts, fakeContext)` with a hand-rolled `container.resolve`/`dataChain` — no Medusa boot.

## #344 analytics edge-offload (CF visitor offload)
- Batch ingest route: `apps/backend/src/api/web/analytics/ingest-batch/route.ts` (POST, AUTHENTICATE=false); pure helpers + HMAC/dedupe in `./lib.ts`; unit spec `./__tests__/lib.unit.spec.ts`.
- HMAC raw-body: route `/web/analytics/ingest-batch` POST has `bodyParser: { preserveRawBody: true }` matcher in `src/api/middlewares.ts` (right after `/web/*` CORS entry, ~line 611). To add another raw-body route, copy that matcher.
- Idempotency col: `analytics_event.event_id` (nullable, indexed) — Migration20260619000000. Ingest reuses `trackAnalyticsEventWorkflow` per event.
- Design doc + slice plan: `apps/docs/notes/525_MODULE_AUDIT_AND_CF_VISITOR_OFFLOAD.md` (slice 2 = CF Worker under apps/analytics-worker; slice 5 = volume sizing).
- **Volume sizing (slice 5) DONE 2026-06-19** → KV not Queues, 60s cron skip-empty (doc "Volume sizing — RESULTS"). **Recipe to measure prod write rate headlessly:** `TOKEN=$(aws ssm get-parameter --name /jyt/prod/ADMIN_OPENAPI_CATALOG_TOKEN --with-decryption --region us-east-1 --query Parameter.Value --output text)`; `BASIC=$(printf '%s:' "$TOKEN" | base64)`; `GET https://v3.jaalyantra.com/admin/websites?limit=50&fields=id,domain` → loop ids → `GET /admin/analytics-events/stats?website_id=<id>&days=30` → sum `stats.overview.total_events` (= pageviews+custom_events; size on this). `…/timeseries` returned empty in this run — use `/stats` overview. Result: ~249 events/day across 9 sites.

## Admin list free-text `q` search (#525 P1)
- Standard pattern: a `q` param → DB-level `$or` of `$ilike` clauses (NOT in-app filter; that's the #484 workaround). Keeps `count`/pagination correct.
- Reusable pure helper: `apps/backend/src/lib/list-search-filters.ts` → `buildQSearchFilter(q, fields)` returns `{ $or: [...] }` or `{}`; spread into existing `filters`.
- Precedents to copy: `src/api/admin/persons/partner/route.ts` (name/handle, query.graph), `src/api/admin/google-merchant/accounts/route.ts`.
- Admin list routes: partners=`src/api/admin/partners/route.ts` (→ `workflows/partners/list-partners.ts`, query.graph entity "partner"); websites=`src/api/admin/websites/route.ts` (→ `workflows/website/list-website.ts` → `WebsiteService.listAndCountWebsites(filters, config)`, MikroORM).
- Website model fields live in `src/modules/website/models/website.ts` (name searchable, domain unique).
- To add q to another admin list: import `buildQSearchFilter`, spread `...buildQSearchFilter(q, [fields])` into the filters object passed to the list workflow.

## #569 S7a sessions list endpoint (analytics dashboard v2)
- `GET /admin/websites/[id]/analytics/sessions?days|start_date&end_date&limit&offset&order_by&order_dir` — paginated session list. Route `src/api/admin/websites/[id]/analytics/sessions/route.ts` (needs 6 `../` to reach `src/workflows`, same depth as `analytics/pages` route). PURE `src/workflows/analytics/reports/sessions-list-lib.ts` (`resolveLimit`[1,100]def20 / `resolveOffset`>=0 / `resolveOrderDir` ASC|DESC defDESC / `SESSION_ORDER_FIELDS` whitelist defstarted_at / `SESSION_SELECT` projection / `resolveSessionListParams`→{take,skip,order}) + workflow `reports/get-website-sessions.ts` (resolve `custom_analytics` + `listAndCountAnalyticsSessions({website_id,started_at:{$gte,$lte}}, {select,take,skip,order})`, best-effort try/catch→empty page). Response `{website_id,period,limit,offset,count,sessions}`. 13 unit `reports/__tests__/sessions-list-lib.unit.spec.ts` + 4 integration `integration-tests/http/analytics/website-sessions-list.spec.ts` (seed via `analyticsService.createAnalyticsSessions([...])`). **To add a paginated module list endpoint: pure param-sanitiser lib (whitelist order col + clamp take/skip) + workflow wrapping `listAndCount<Model>`, route maps query→input. ⚠ whitelist order_by to prevent arbitrary-column ordering.**
- **S7b sessions DataTable UI (PR #636 OPEN, stacked on #635):** hook `useWebsiteAnalyticsSessions(websiteId,{days,limit,offset,order_by,order_dir},{placeholderData})` + types `AnalyticsSession`/`WebsiteAnalyticsSessionsResponse`/`SessionOrderField` in `src/admin/hooks/api/analytics.ts`. Card `src/admin/components/websites/analytics-sessions-card.tsx` — Medusa `DataTable`/`useDataTable` (mirror `forms/form-responses-section.tsx`: `createColumnHelper`+`DataTablePaginationState`+`keepPreviousData`, server-side via `offset=pageIndex*pageSize`, `rowCount={count}`). Wired in `website-analytics-modal.tsx` before breakdown section, `days={currentDays}`. **To add a paginated DataTable admin card: copy form-responses-section.tsx pattern; columns via columnHelper.accessor; pass rowCount+pagination state to useDataTable for server-side paging.**

## Email / notification system (#332 partner email audit)
- **Providers** registered in `medusa-config.prod.ts` (~169-216) + `.dev.ts`: Resend=`email`, Mailjet=`email_bulk`, Maileroo=`email_partner`, local=`feed`, whatsapp-audit=`whatsapp`. ⚠ Base `medusa-config.ts` (what `medusa develop` + integration tests load) ONLY has local+whatsapp-audit → local dev can't actually send partner/customer email; `email_partner`/`email_bulk` have no provider there.
- **Send architecture:** subscriber → email workflow → resolve partner+admins → `EmailTemplatesService.getTemplateByKey(key)` (`src/modules/email_templates/service.ts`; THROWS NOT_FOUND if row missing or is_active=false) → Handlebars compile → `notificationModuleService.createNotifications({to,channel,template,data})` with `_template_html_content/_template_subject/_template_from/_template_processed:true`. Resend falls back to `src/modules/resend/templates/default-email.tsx` if `_template_processed` absent.
- **Partner emails go via `email_partner`/Maileroo.** Pattern file: `src/workflows/email/workflows/send-partner-order-email.ts` (+ step `steps/resolve-partner-from-order.ts` = order→sales_channel→store→`partner_partner_store_store` link→partner+admins; from = `partner+<handle>@${MAILEROO_FROM_DOMAIN||partner.jaalyantra.com}`).
- **Generic email workflow** `src/workflows/email/workflows/send-notification-email.ts` HARDCODES `channel:"email"` (Resend) — do NOT use for partner channel.
- **Prod email templates** (verify which keys exist/active): `GET https://v3.jaalyantra.com/admin/email-templates?limit=100` Basic-auth `sk_…:` from SSM `/jyt/prod/ADMIN_OPENAPI_CATALOG_TOKEN` **region us-east-1** (NOT ap-south-1). Response shape `{emailTemplates,count}`. ⚠ passing `fields=` projection on this route returns 0 rows — omit it. 42 active templates as of 2026-06-21.
- **task_assigned email (FIXED #332):** `runTaskAssignmentWorkflow` (`src/workflows/tasks/run-task-assignment.ts:24`) emits `task_assigned {task_id,partner_id}`; subscriber `src/subscribers/task-assigned.ts` (was empty stub) now → `sendPartnerTaskAssignedWorkflow` (`src/workflows/email/workflows/send-partner-task-assigned-email.ts`) → template `partner-task-assigned` via `email_partner`. Pure helper `src/workflows/email/lib/partner-task-email.ts` (`buildPartnerTaskTemplateData`/`derivePartnerFromEmail`), 9 unit.
- **To wire a new partner email:** add DB template (seed `src/scripts/seed-email-templates.ts`), build a workflow mirroring send-partner-order-email (resolve partner+admins, getTemplateByKey, Handlebars, channel `email_partner`), invoke best-effort from the subscriber. Full register: `apps/docs/notes/332_PARTNER_EMAIL_E2E_AUDIT.md`.
- **Customer order-canceled email (#576 slice A, PR #577):** `subscribers/order-canceled.ts` now ALSO emails the customer via `workflows/email/workflows/send-order-canceled-customer-email.ts` (template key `order-canceled`, channel `email`/Resend, mirrors `send-order-confirmation-email.ts`). Pure helper `workflows/email/lib/order-canceled-customer-email.ts` = `shouldSendCustomerCancellationEmail`(skip on `no_notification` event flag OR `order.metadata.no_notification` OR no email) + `buildOrderCanceledCustomerEmailData`. **#576 NOW FULLY BUILT** (A=#577, B=#579, C=#580 — all OPEN/independent).
- **Production-run partner email (#576 slice B, PR #579):** NEW dedicated subscriber `subscribers/production-run-partner-email.ts` (listens `production_run.completed`+`production_run.cancelled`, runs alongside feed-only `production-run-notifications.ts`) → `workflows/email/workflows/send-partner-production-run-email.ts` (mirrors send-partner-task-assigned; channel `email_partner`; resolves partner from `event.partner_id` OR `run.partner_id`). Pure lib `workflows/email/lib/partner-production-run-email.ts` (`resolvePartnerProductionRunTemplateKey`+`buildPartnerProductionRunTemplateData`, 10 unit). Template keys `partner-production-run-{completed,cancelled}`. ⚠ `production_run.completed` carries partner_id (emit: `workflows/production-runs/complete-production-run.ts`); `cancelled` from `api/admin/production-runs/[id]/cancel/route.ts` does NOT (only `decline-production-run.ts` does) → ALWAYS fall back to `run.partner_id`. production_run model has `partner_id: model.text().nullable()` directly (no link hop); service method `retrieveProductionRun(id)`.
- **Region-request admin email (#576 slice C, PR #580):** `api/store/contact-region-request/route.ts` (synchronous storefront route, NOT a subscriber) — after creating its `feed` notification it now ALSO best-effort emails an admin inbox via `workflows/email/workflows/send-region-request-admin-email.ts` (template key `region-request-admin`, channel `email`/Resend; fetch+send, no WorkflowResponse). Pure lib `workflows/email/lib/region-request-admin-email.ts` = `resolveRegionRequestRecipient`(env precedence `REGION_REQUEST_NOTIFY_EMAIL`→`ADMIN_NOTIFY_EMAIL`→`MAILJET_FROM_EMAIL`, null when none) + `buildRegionRequestAdminEmailData`. 10 unit + 5 integ. ⚠ Best-effort pattern for a route-triggered email: call `wf(req.scope).run({ input, throwOnError:false })` inside try/catch so a missing template / unconfigured recipient / provider error can never 500 the request. Template key NOT in the common seed helper → seed per-test.
- **To add a customer/admin email touchpoint:** mirror `send-order-confirmation-email.ts` (channel `email`); for partner mirror `send-partner-order-email.ts` (channel `email_partner`). Export from `workflows/email/index.ts`. Add the template key to `integration-tests/helpers/seed-email-templates.ts` (it posts `template_type:"email"`). Workflow returns no WorkflowResponse → assert `run.errors` is `[]`.
- **DB email-template SEED scripts** live in `src/scripts/seed-*email*.ts` (NOT the integration helper): `seed-email-templates.ts` (~40 core keys: order-placed, order-shipment-created, payment-captured, …), `seed-partner-email-templates.ts` (partner/admin), `seed-additional-email-templates.ts` (#450 PR #618 — partner-welcome/order-feedback-request/payment-receipt). **Pattern:** export the rows as a `const` (unit-testable: unique keys + `{{var}}` docs), loop with `getTemplateByKey` try/catch for idempotency. ⚠ Before adding a "new" template, `grep template_key src/scripts/*.ts` — #450 wanted order-confirmation+shipment but those already exist as `order-placed`/`order-shipment-created`.

## Feedback module + post-delivery feedback (#452, PR #619)
- Module `src/modules/feedback/` (`FEEDBACK_MODULE="feedback"`): model `models/feedback.ts`
  (rating enum/comment/status enum/submitted_by/submitted_at/reviewed_*/metadata + **`order_id`
  nullable** durable link added #452). Service auto-methods `createFeedbacks`/`listFeedbacks`/
  `softDeleteFeedbacks`. Existing workflows in `src/workflows/feedback/` (create/update/delete/list).
- **`delivery.created` event** = the "order delivered" trigger; data `{ id, no_notification }` where
  `id` is the FULFILLMENT id. Existing subscriber `src/subscribers/delivery-created.ts` sends the
  delivered shipment email via `sendShipmentStatusEmail` (status "delivered"). To resolve order+customer
  from that id, reuse `retrieveShipmentDetailsStep` (`src/workflows/email/steps/retrieve-shipment-details.ts`,
  entity "fulfillment" → order.email/display_id/etc).
- **#452 (PR #619):** new subscriber `src/subscribers/order-delivered-feedback.ts` (runs ALONGSIDE
  delivery-created.ts) → workflow `src/workflows/feedback/request-post-delivery-feedback.ts` (retrieve
  shipment → idempotent create-or-reuse feedback keyed on `order_id` → `when(has email).then(...)`
  fetchEmailTemplateStep+sendNotificationEmailStep, template `order-feedback-request` from #450).
  Pure helpers `src/workflows/feedback/lib/post-delivery-feedback.ts`. **Recipe — customer email
  touchpoint w/ a DB side-effect:** put load-bearing linkage in a typed column (migration), keep the
  send conditional + best-effort, unit-test the pure decision/data helpers, integration-test the
  column+idempotency at the SERVICE level (full delivered-fulfillment e2e not headlessly verifiable).

## Partner storefront analytics digest (#581)
- **S1 digest compute (PR #582 OPEN):** PURE `src/workflows/analytics/partner-digest-lib.ts` (`resolvePeriodRange`/`computeDigestMetric`/`buildDigestKpis`/`breakdownToItems`/`buildDigestSuggestions`+`DEFAULT_DIGEST_THRESHOLDS`; 29 unit) + workflow `src/workflows/analytics/get-partner-storefront-digest.ts` (`getPartnerStorefrontDigestWorkflow`, input `{partner_id,period?,thresholds?,now?}`). Resolves partner→website via `refetchPartner` + WebsiteService (col→metadata→domain), reuses `getWebsiteAnalyticsOverviewWorkflow` (#569) + `getAnalyticsBreakdownWorkflow` (#559) via `workflow(container).run()`. Never throws; empty digest for un-provisioned partner. **To add a suggestion rule: edit `buildDigestSuggestions` + a threshold in `DigestThresholds`/`DEFAULT_DIGEST_THRESHOLDS` + a unit test.** Next: S2 email (stack on S1 branch), S3 visual-flow op (mirror `operations/cart-recovery-stats.ts`).
- **S2 digest email (PR #583 OPEN, stacked on #582):** PURE `src/workflows/analytics/partner-digest-email-lib.ts` (`buildPartnerDigestTemplateData`→Handlebars data: 6 fmt `kpi_rows`, breakdown arrays for `{{#each}}`, suggestion flags; + `derivePartnerDigestFromEmail`/`formatDigestDate`(UTC)/`directionArrow`/`deltaLabel`/`formatDuration`; 15 unit) + workflow `src/workflows/analytics/send-partner-digest-email.ts` (`sendPartnerDigestEmailWorkflow({digest,partner_id?})`, mirrors send-partner-task-assigned: resolve partner+active admins→`getTemplateByKey("partner-storefront-digest")`→Handlebars→`email_partner`/Maileroo per-admin, best-effort). From-addr helper re-implemented locally (NOT imported from `workflows/email/lib/` — #578). **Ops tail: author `partner-storefront-digest` email_template row (active) + env MAILEROO_FROM_DOMAIN/PARTNER_DASHBOARD_URL/FRONTEND_URL.**
- **S3 visual-flow op (PR #584 OPEN, STACKED on #582 — NOT #583; imports S1 wf+types so can't branch off main):** `src/modules/visual_flows/operations/partner-analytics-digest.ts` op type `partner_analytics_digest` (category data) wraps S1 `getPartnerStorefrontDigestWorkflow(container).run()` per partner. Selects one (`partner_id`)/explicit list (`partner_ids`, `{{ }}` refs interpolated via `interpolateVariables`)/all `status:active` partners (`partnerService.listAndCountPartners({status:'active'},{take,select:['id']})`, `PARTNER_MODULE` from `src/modules/partner`). Per-partner errors swallowed (`continue_on_error` default). Output `{digests[],records,count,with_storefront,with_suggestions,suggestion_count,requested,failed,errors}` → `bulk_trigger_workflow` (`items:{{op.digests}}`, `input_template:{digest:"{{item}}"}`) → S2. Pure `selectDigestPartnerIds`(precedence explicit>listed, dedupe, cap)/`summarizeDigestRun`; 16 unit. **To add a visual-flow op: create `operations/<name>.ts` exporting `OperationDefinition` + register in `operations/index.ts` (3 spots: re-export, import, `registerBuiltInOperations()` call).**
- **#589 recipient filter (PR #590 OPEN, off main INDEPENDENT):** same op file `partner-analytics-digest.ts` — after computing digests, `partitionEligibleDigests(digests)→{eligible,excluded}` (via pure `isPartnerDigestEligible`= truthy `website.id`) filters the `digests[]`/`records` fan-out so `bulk_trigger`→email only mails live-storefront partners; no-store (`website:null`) excluded, has-store+0-traffic kept (zero-data nudge slice). Output +`computed`/`excluded`. S3 spec 16→22. #589 queue: item3 ai-extract summary.
- **#589 zero-data nudge (PR #591 OPEN, off main INDEPENDENT):** pure `digestHasData(digest)` in `src/workflows/analytics/partner-digest-email-lib.ts` (truthy on any of `kpis.{unique_visitors,pageviews,sessions}.current`) + `has_data` added to `buildPartnerDigestTemplateData` output. Seed template `partner-storefront-digest` in `src/scripts/seed-partner-email-templates.ts` wraps stats in `{{#if has_data}}` + adds `{{#unless has_data}}` share-your-store nudge. +4 unit (spec 19/19). **⚠ prod email templates are authored via admin API + NOT re-seeded on deploy — editing seed html only affects fresh envs; live template needs a manual admin-API html patch.** **To add an email-template var/branch: edit BOTH `buildPartnerDigestTemplateData` (data) + the seed `html_content` (Handlebars), and remember the live prod template needs an API patch.**
- **#589 AI summary data contract (PR #592 OPEN, STACKED on #591 — same files: email-lib + seed template):** optional `ai_summary?:string|null` on `PartnerStorefrontDigest` (`partner-digest-lib.ts`) rides on the digest so it survives the `bulk_trigger`→email hand-off. Pure `sanitizeAiSummary(raw)` + `AI_SUMMARY_MAX_LEN=600` in `partner-digest-email-lib.ts` (collapse ctrl/ws→1 para, word-boundary ellipsis cap, ""=non-string/blank; NOT html-sanitiser — Handlebars escapes). `buildPartnerDigestTemplateData` adds `ai_summary`+`has_ai_summary`. Seed template `{{#if ai_summary}}` callout above KPIs inside `{{#if has_data}}`. +7 unit (spec 19→26). **Optional+absent by default ⇒ email unchanged until the flow sets `digest.ai_summary`.** Live wiring DEFERRED — prefer an `ai-extract` enrich INSIDE the `partner_analytics_digest` op (set `digest.ai_summary` before `partitionEligibleDigests`, best-effort) over a node in the email wf. Doc §3. **#589 build COMPLETE (slices 1/2/3 = #590/#591/#592).**
- **#589 item3 AI summary GENERATION (PR #593 OPEN, STACKED on #592 — depends on its `ai_summary` field + `sanitizeAiSummary`):** NEW pure `src/workflows/analytics/partner-digest-ai-lib.ts` — `buildDigestAiPrompt(digest)→{system,prompt}` (deterministic) + `composeDigestAiSummary(digest, generate, opts?)` with an INJECTED `DigestAiGenerate` seam (`{system,prompt,model}→Promise<string>`) so it's unit-testable w/o network; best-effort (skips zero-data via `digestHasData`, sanitises+caps, returns null on throw). `DIGEST_AI_DEFAULT_MODEL`. Op `partner-analytics-digest.ts` gains **default-off** `generate_ai_summary` + `ai_summary_model` options; when on, builds an OpenRouter `generate` (mirrors `operations/ai-extract.ts`: `createOpenRouter({apiKey:process.env.OPENROUTER_API_KEY})`+`generateText`) and sets `digest.ai_summary` in the compute loop pre-`partitionEligibleDigests`. 11 unit (`partner-digest-ai-lib.unit`)→59 green. **To populate digest.ai_summary live: flip `generate_ai_summary:true` on the live op node (no code change) once OPENROUTER_API_KEY in prod.** **Merge #590→#591→#592→#593.**
- **#589 item4 AI provider from External Platforms (PR #610 OPEN, off main INDEPENDENT):** replaced the hardcoded `createOpenRouter({apiKey:process.env.OPENROUTER_API_KEY})` block in `partner-analytics-digest.ts` with `getAiPlatformForRole(container,"ai_digest_summary")`+`buildChatModel(cfg,modelOverride)` from `src/mastra/services/ai-platforms.ts` (mirrors `operations/ai-extract-platform.ts` — THE reference impl for DB-resolved AI providers). Resolve platform ONCE before the loop; null⇒`aiGenerate` null⇒`ai_summary` unset (no throw, best-effort). Added `"ai_digest_summary"` to the `AiRole` union (ai-platforms.ts; `AI_ROLES` array left alone — intentional subset). New PURE `resolveDigestModelOverride(opt,platformDefault,fallback=DIGEST_AI_DEFAULT_MODEL)` in `partner-digest-ai-lib.ts` (precedence opt>platform default>fallback hint). 7 unit→18 in `partner-digest-ai-lib.unit`. **To DB-resolve any visual-flow AI op: `getAiPlatformForRole(container,role)`→`buildChatModel(cfg,override)`; admin creates External Platform category=ai + metadata.role=<role> + is_default=true (no backfill seeds new roles).** Analysis: `apps/docs/notes/589_SOCIALS_AI_PROVIDER_ANALYSIS.md`.
- **S4 seed weekly flow (PR #586 OPEN, off main INDEPENDENT — string refs, no imports):** `src/scripts/seed-partner-analytics-digest-flow.ts` exports `FLOW_DEF` + `default async ({container})` runner. Mirrors `seed-production-run-reminders-flow.ts` (SCHEDULE trigger pattern). Graph: trigger (cron `30 3 * * 1`=09:00 IST Mon/UTC, status `draft`) → `partner_analytics_digest` op (no selector ⇒ all active partners, period `last_7_days`) → `bulk_trigger_workflow` (`workflow_name:"send-partner-digest-email"`, `items:"{{ compute_digests.digests }}"`, `input_template:{digest:"{{ item }}"}`, max_items 200) → `log`. 7 structural unit `__tests__/seed-partner-analytics-digest-flow.unit.spec.ts` pin string refs+linear graph. Doc `apps/docs/notes/581_PARTNER_STOREFRONT_DIGEST.md`. **#581 BUILD COMPLETE (S1-S4); S5 ai-extract optional.**
- **To seed a schedule-triggered visual flow:** new `src/scripts/seed-<name>-flow.ts` exporting `FLOW_DEF` (for unit-testability) + `default async ({container})` → resolve `VISUAL_FLOWS_MODULE` service → `listVisualFlows({name})` idempotency guard → `service.createCompleteFlow({ flow:{name,description,status,trigger_type:"schedule",trigger_config:{cron},canvas_state}, operations, connections })`. **canvas_state (React-Flow nodes/edges) REQUIRED** or editor opens empty. Each operation row = `{operation_key, operation_type, name, sort_order, position_x/y, options}`; connections mirror canvas edges. Run `npx medusa exec ./src/scripts/<seed>.ts`. `bulk_trigger_workflow` op output keys = `triggered`/`failed`/`records`/`results`. `inspect-visual-flow.ts` dumps a seeded graph.

## Partner Sales Channel routes (PR #596 audit)
- Partner routes ALREADY EXIST: `apps/backend/src/api/partners/stores/[id]/sales-channels/route.ts` (LIST/CREATE) +
  `[channelId]/route.ts` (GET/UPDATE/DELETE) + `[channelId]/products/batch/route.ts`. Validators
  `PartnerCreate/UpdateSalesChannelReq` in `stores/[id]/validators.ts` (~L207). Middlewares in `middlewares.ts` ~L1963-2005.
- Admin contract source: `node_modules/@medusajs/medusa/dist/api/admin/sales-channels/{route.js,[id]/route.js,validators.js,query-config.js}`.
  DELETE envelope object = HYPHEN `"sales-channel"` (mirror it). Workflows create/update/deleteSalesChannelsWorkflow.
- Partner→sales_channel scope = NO link table; derive via partner→`partner_stores`→store→(`default_sales_channel_id` +
  `stock_locations.sales_channels` of `default_location_id`). Single routes scope to default channel ONLY.
- Audit register + remaining drifts: `apps/docs/notes/PARTNER_API_PARITY.md` (Sales Channel section). Next 🆕 audits in that
  doc: Shipping Option, Fulfillment Set/Location.
- Partner shipping-option routes: `apps/backend/src/api/partners/stores/[id]/shipping-options/route.ts` (list/create) + `[optionId]/route.ts` (read/update/delete). Admin counterpart: `node_modules/@medusajs/medusa/dist/api/admin/shipping-options/{route.js,[id]/route.js,helpers.js(refetchShippingOption)}`. Partner-ui hook: `apps/partner-ui/src/hooks/api/shipping-options.tsx` (create invalidates, ignores body).
- Partner fulfillment-sets routes (next parity 🆕): `apps/backend/src/api/partners/stores/[id]/fulfillment-sets/[fulfillmentSetId]/service-zones/[serviceZoneId]/route.ts`. Admin: `node_modules/@medusajs/medusa/dist/api/admin/fulfillment-sets/`.

## Analytics pure helpers (`*-lib.ts`) + unit specs (#569/#581/#559/#594)
- Framework-free compute helpers co-located next to workflows in `apps/backend/src/workflows/analytics/`: `session-metrics-lib.ts` (`computeSessionMetrics`), `partner-digest-lib.ts` (`resolvePeriodRange`/`computeDigestMetric`/`buildDigestKpis`/`breakdownToItems`/`buildDigestSuggestions`), `partner-digest-{ai,email}-lib.ts`, and `reports/{breakdown,session-pages,sessions-list,outbound-links}-lib.ts`.
- EVERY one already has a `__tests__/<name>.unit.spec.ts` (and `reports/__tests__/`). To DEEPEN coverage without touching the existing happy-path spec, add a sibling `<name>.edge.unit.spec.ts` (additive, conflict-free). Run per-file: `cd apps/backend && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest --testPathPattern=<name>.edge`.

## Admin route patterns: modals, exchange rates, ad-planning goals (#558/#501/#568)
- **RouteFocusModal / RouteDrawer mount the `RouteModalProvider`** (`components/modal/route-focus-modal.tsx`, `.../route-drawer/route-drawer.tsx`). `useRouteModal()` (→ `handleSuccess`) may ONLY be called by components rendered as CHILDREN of `<RouteFocusModal>`/`<RouteDrawer>` — calling it in the page component (the parent) throws `useRouteModal must be used within a RouteModalProvider` and the error boundary swallows the whole route. Fix recipe: put the hook in an inner `<XBody>` rendered inside the modal. Add `<Modal.Title asChild>`/`<Modal.Description>` (or `sr-only`) or you get a DialogTitle a11y console warning.
- **FocusModal has NO explicit z-index** (relies on portal DOM order) → a sibling Radix Popover/portal needs `z-[1000]` to sit above it. Bit the analytics Filters popover (`components/websites/website-analytics-modal.tsx`).
- **Exchange-rate routes**: `GET /admin/exchange-rate` (singular, `{from,to,rate}`, draft-order flow) AND now `GET /admin/exchange-rates` (plural, `{base,rates}`, multi-target, product-from-media). Both proxy Frankfurter server-side via `fetchExchangeRate` exported from `workflows/designs/create-draft-order-from-designs.ts` (1h in-mem cache). Admin UI must NEVER fetch api.frankfurter.app directly (browser CORS = "Rate Fetching Failed").
- **Ad-planning Goals UI**: list `admin/routes/ad-planning/goals/page.tsx`; create `.../goals/create/page.tsx` (now RouteFocusModal); detail `.../goals/[id]/page.tsx` (renders `<Outlet/>`); edit parallel route `.../goals/[id]/@edit/page.tsx` (RouteDrawer); shared form `components/ad-planning/goals/goal-form.tsx`. Goal event-name lives in `conditions.event_name` JSON (NO `trigger_event_name` column). `goal_type` enum value is `custom_event` (NOT `custom`). Subscriber: `subscribers/ad-planning/analytics-event-created.ts` + pure `match-custom-goal.ts`.

## Local admin login for Playwright (durable)
- No known-password seeded admin. Make one: `cd apps/backend && npx medusa user --email daemon2@jyt.local --password 'Pw123456!'`. Admin SDK uses **session cookie** auth (`admin/lib/config.ts` `auth.type:"session"`) → Playwright MUST log in via the UI form (localStorage-JWT injection fails). Login wait: `waitForURL(u=>!u.includes('/login'))` (plain `**/app**` matches the login page). For curl: `POST /auth/user/emailpass` → `.token` as Bearer.

## Partner broadcast notifications (#453, PR #617)
- **Fan-out feed notification to partners:** `createPartnerNotification(scope, {partner_id,title,description,url,channel?,trigger_type,resource_type,...})` at `src/lib/notifications/create-partner-notification.ts` — channel defaults `feed`, writes `notifications.receiver_id=partner_id`; swallows+logs failures → bool. Bell feed read = `src/api/partners/notifications/route.ts` (filter `receiver_id`).
- **To add an admin route that hits all partners:** page `query.graph({entity:"partners",fields:["id","status"],pagination})` (no single "list all" helper); broadcast route at `src/api/admin/partners/notifications/broadcast/{route,lib,validators}.ts`. Register matcher in `middlewares.ts` BEFORE `/admin/partners` GET (3-segment path, no `:id` collision).
- **#496 payment attachments (PR #620):** file↔payment LINK TABLE for internal payments. Model `modules/internal_payments/models/payment_attachment.ts` (`internal_payment_attachment`: belongsTo Payment `payment_id` FK + file_id/url/filename/mime_type/size/metadata); Payment gains `attachments: model.hasMany`; both added to `service.ts`. Migration `Migration20260622103000.ts` (new table only = SAFE). Pure `lib/normalize-attachments.ts` (dedupe by file_id, drop missing file_id/url). Workflow `workflows/internal_payments/create-payment-and-link.ts` `createPaymentAttachmentsStep` gated `when(attachments?.length)`. Routes accept `attachments[]`: `api/admin/payments/link` (validators.ts `PaymentAttachmentSchema`) + partner `api/partners/inventory-orders/[orderId]/submit-payment/route.ts`. **Medusa File module (`Modules.FILE`) has NO DB `.linkable` → cannot `defineLink` to files; a dedicated in-module child model IS the link table.** Admin upload: `@add-payments/page.tsx` FileUpload→`useFileUpload`(`hooks/api/upload.ts` = `sdk.admin.upload`, returns `{files:[{id,url}]}`)→`attachments`; display chips in `components/inventory-orders/inventory-order-payments-section.tsx`; detail query (`routes/orders/inventory/[id]/page.tsx`) needs `+internal_payments.attachments.*`.

### External Platforms / AI providers (#613)
- Create AI provider form: `apps/backend/src/admin/components/social-platforms/create-ai-platform-component.tsx` (route `/settings/external-platforms/create-ai`). Generic create = `/create`.
- AI platform data shape: `metadata.provider_type` (openrouter|dashscope|cloudflare|vercel_ai_gateway|fal|custom), `api_config.default_model`, `api_config.account_id` (cloudflare), `api_config.base_url`. NOT `api_config.provider` (that's social/email).
- Detail page `[id]/page.tsx` → `social-platform-general-section.tsx` renders the general fields + (now) AI warnings.
- Provider defaults/normalize: `apps/backend/src/mastra/services/ai-platforms.ts` (PROVIDER_DEFAULTS ~L74, normalizeProviderType ~L103, cloudflare base-url derive ~L207).
- To add a cross-form AI validation/warning: write a pure helper next to `cloudflare-model-warning.ts` and reuse in both the create form (`form.watch`) and the general section (reads metadata+api_config).

## Analytics dashboard v2 (#569, OpenPanel parity)
- **The modal** = `apps/backend/src/admin/components/websites/website-analytics-modal.tsx` (~690L) — route
  `routes/websites/[id]/analytics/page.tsx` renders `<WebsiteAnalyticsModal/>`; open via `/app/websites/<id>/analytics`.
  Overview MetricCards grid ~L410; second engagement-cards row (#569 S1b, PR #630) below it; `MetricCard` + `formatDuration` helpers at bottom. ALL UI render slices touch THIS file → land sequentially.
- **Overview data**: route `apps/backend/src/api/admin/websites/[id]/analytics/route.ts` returns
  `getWebsiteAnalyticsOverviewWorkflow` result verbatim. `stats` includes session metrics
  (`bounce_rate` 0..1, `avg_session_duration` secs, `pages_per_session`, `views_per_visitor`, `total_sessions`)
  computed by pure `apps/backend/src/workflows/analytics/session-metrics-lib.ts#computeSessionMetrics`.
- **Hook**: `apps/backend/src/admin/hooks/api/analytics.ts#useWebsiteAnalytics` (→ `/admin/websites/:id/analytics`);
  `WebsiteAnalyticsResponse.stats` must be kept in sync with the overview type. `useAnalyticsBreakdown` (same file)
  → `/admin/analytics-events/breakdown`; pure query builder + dim union in `analytics-breakdown-query.ts`
  (MIRROR of server `workflows/analytics/reports/breakdown-lib.ts` — keep both in sync; `referrer` is a dim).
- **Breakdown explorer UI (#566, MERGED)**: `apps/backend/src/admin/components/websites/analytics-breakdown-section.tsx`
  — `DIMENSION_LABELS` MUST cover every `BreakdownDimension` (it's a `Record<...>`; missing key = TS2741, e.g. the `referrer` gap fixed in PR #630).
- **#569 backend ALL built**: S1 (session-metrics-lib), S2 entry/exit (`reports/session-pages-lib.ts` + `.../analytics/pages/route.ts`),
  S5a outbound (`apps/analytics/src/analytics.js` `link_out`), S6 referrer dim, S7a sessions (`reports/sessions-list-lib.ts` + `.../analytics/sessions/route.ts`).
  REMAINING UI render: S7b (sessions DataTable via `/analytics/sessions`), S8 (timeseries toggle; `useAnalyticsTimeseries` takes interval). DONE: S4 (Top-404), **S2b (entry/exit, PR #634)**, **S5b (outbound, PR #635)**.
  - **S5b DONE (PR #635, stacked on #634):** self-contained `components/websites/analytics-outbound-links-card.tsx` (single ranked-bar column, same inline-bar style as S2b — `bg-ui-bg-component` track; icon `ArrowUpRightOnBox`) + new hook `useWebsiteAnalyticsOutbound(websiteId,{days,limit})` in `hooks/api/analytics.ts` → `GET /admin/websites/:id/analytics/outbound` (envelope `{outbound_links:{total_events,total_unique_visitors,results:[{value,count,unique_visitors,percentage}]}}`). Wired into modal between Entry/Exit and Top-404. Seed test data: PUBLIC POST `/web/analytics/track` `{event_type:custom_event,event_name:link_out,metadata:{href}}`.
  - **S2b DONE (PR #634, stacked on #633):** self-contained `components/websites/analytics-entry-exit-pages-card.tsx` (two ranked-bar columns) + new hook `useWebsiteAnalyticsPages(websiteId,{days,limit})` in `hooks/api/analytics.ts` → `GET /admin/websites/:id/analytics/pages` (returns `pages.{entry_page,exit_page}` each `{dimension,total_sessions,total_unique_visitors,results:[{value,count,unique_visitors,percentage}]}`). Inline bars use `bg-ui-bg-component` track; icons `ArrowDownLeftMini`/`ArrowUpRightMini`. Wired into modal above Top-404 card.
  **S3 DONE (PR #632, stacked on #630):** Traffic Sources PieChart → `RankedBarList` (component at bottom of `website-analytics-modal.tsx`: OpenPanel-style ranked horiz bars, Medusa-token only — `bg-ui-bg-component` track / `bg-ui-fg-muted` fill, no hex; shows name+count+%). Reuse it for S5b/Top-Countries. `PieChart`/`Pie` recharts imports removed; `COLORS` hex array still used by Top Countries bar only.
- **UI verify recipe**: dev :9000 up; Node Playwright (python broken) — login `/app/login` with `verify-pw@jyt.local`/`Verify12345!`,
  find a website with data via `GET /admin/websites/:id/analytics?days=3650` (jaalyantra.com has sessions), goto the analytics route, screenshot.

## Credential store / external platforms (n8n #585, AI providers)
- Encrypted external-API credential store = `apps/backend/src/modules/socials/models/SocialPlatform.ts` (`category`,
  `auth_type`, `base_url`, encrypted `api_config` json, `metadata`, `status`). Admin CRUD `apps/backend/src/api/admin/social-platforms/`.
- Crypto: `apps/backend/src/modules/encryption/service.ts#EncryptionService` (AES-256-GCM). Decrypt helpers
  `apps/backend/src/modules/socials/utils/token-helpers.ts#{decryptApiKey,decryptAccessToken}`.
- DB-resolve a provider by role: `apps/backend/src/mastra/services/ai-platforms.ts#getAiPlatformForRole(container,role)`
  (selects category=ai + metadata.role; THE reference pattern for runtime credential resolution). Analysis: `apps/docs/notes/585_N8N_INTEGRATIONS_ANALYSIS.md`.

## Messaging / partner chat (#454)
- Module `apps/backend/src/modules/messaging/` — `Conversation` (`models/conversation.ts`, ALREADY has `partner_id`;
  `phone_number` NON-nullable=WA-coupled) + `Message` (`models/message.ts`). Admin inbox `api/admin/messaging/` (list filters
  partner_id; `[conversationId]/route.ts` POST=send, enforces WhatsApp 24h window). Inbound `api/webhooks/social/whatsapp/route.ts`
  → `workflows/whatsapp/whatsapp-message-handler.ts#persistInboundMessage`. NO `api/partners/messaging` yet. Analysis: `apps/docs/notes/454_PARTNER_CHAT_SUPPORT_ANALYSIS.md`.

## Task templates / actions (#451)
- `apps/backend/src/modules/tasks/models/{tasktemplate.ts,task.ts}` (`required_fields` json precedent; `eventable`/`notifiable`/`message_template` = only existing action hooks).
  Instantiation: `workflows/tasks/create-task.ts#createTaskWorkflow` + `modules/tasks/service.ts#createTaskWithTemplates` (copies template fields) ← snapshot actions HERE.
  Lifecycle subscriber precedent `apps/backend/src/subscribers/task-assigned.ts`. Action executor backend = visual-flows `operationRegistry`. Analysis: `apps/docs/notes/451_DYNAMIC_TASK_TEMPLATES_ANALYSIS.md`.

## Social-platform admin forms (#427, #628)
- Config mapping single-source = `apps/backend/src/admin/components/social-platforms/api-config.ts` (`buildApiConfig`/`inferAuthType`/`getFormDefaultsFromApiConfig`). The RENDER switch is separate: `category-provider-fields.tsx` → per-category `<X>ProviderFields>` + `CATEGORIES_WITH_PROVIDER_FIELDS`/`hasProviderFields`.
- Edit form `edits/edit-social-platform.tsx`: `EditCategoryPlatformForm` (when `hasProviderFields`) renders `<CategoryProviderFields>`; else generic `DynamicForm`. To add a category's editable fields: (1) add the case to both switches, (2) add to `CATEGORIES_WITH_PROVIDER_FIELDS`, (3) build a `<X>ProviderFields>` (use `disabled={isEditing}` to lock immutable fields).
- AI platforms store `provider_type`/`role`/`is_default` in **`metadata`**, not `api_config` (`create-ai-platform-component.tsx`). So the `ai` `buildApiConfig` case must NOT emit `provider`; seed the locked provider_type from `socialPlatform.metadata` in the edit defaults.
- Update route `api/admin/social-platforms/[id]/route.ts`: only writes `metadata` if passed (omit → preserved); `preserveExistingSecrets` (secrets.ts `PLAINTEXT_SECRET_FIELDS` incl `api_key`) restores omitted/blank secrets.
- No AI platform in dev DB (prod-only) — create one via admin API to Playwright-test the edit form; delete after.

## Analytics dashboard (#559 / #569) — timeseries (S8)
- Modal: `apps/backend/src/admin/components/websites/website-analytics-modal.tsx`. Self-contained cards live as siblings (`analytics-*-card.tsx`) and only import+mount in the modal → #569 UI slices stack cleanly.
- Hooks: `apps/backend/src/admin/hooks/api/analytics.ts`. `sdk.client.fetch` RESOLVES THE PARSED BODY DIRECTLY — `return res`, NEVER `res.body` (the latter = undefined → react-query throws). Buggy `res.body` still in `useAnalyticsStats` (~L273) + L334 hook; fix when touched.
- Timeseries endpoint `GET /admin/analytics-events/timeseries?website_id&days&interval=day|hour` → `{website_id, period, data:[{timestamp,pageviews,custom_events,total_events,unique_visitors,unique_sessions}]}`. Route `api/admin/analytics-events/timeseries/route.ts`; workflow `workflows/analytics/reports/get-analytics-timeseries.ts`.
- GOTCHA (general): Medusa workflow step Date inputs arrive JSON-serialized as ISO **strings** → `Date <= string` is NaN. Always `new Date(input.someDate)` at the top of the step before comparing/looping.
- Seed analytics events in integration tests: `container.resolve("custom_analytics").createAnalyticsEvents([...])`; `pathname` is REQUIRED (non-nullable) on every row incl `custom_event`. Model: `modules/analytics/models/analytics-event.ts`.

## Shiprocket carrier flows (#642/#641/#639)
- Resolver: `apps/backend/src/modules/shipping-providers/resolver.ts` `resolveShippingProvider(container,carrier)` — env fallback now `SHIPROCKET_PASSWORD||SHIPROCKET_API_PASSWORD`. Client `shiprocket/client.ts` (getRates L257 `/courier/serviceability/`, listPickupLocations L477, createShipment). `pickup-locations.ts` `chooseRegisteredPickup` (only on PR #640, NOT main yet).
- Admin carrier routes: `src/api/admin/orders/[id]/{shiprocket-label,shiprocket-attach-awb,shiprocket-rates}/route.ts`. Label/rates reuse `workflows/orders/{shiprocket-shipment.ts (createShiprocketShipmentForFulfillment, buildCreateShipmentInput, accepts preferredCourierId),shiprocket-rates.ts (getShiprocketRatesForOrder + pure pickRatesPickup),shiprocket-attach-awb.ts (attachExistingShiprocketAwb),fulfillment-context.ts (ensureOrderFulfillment)}`. NO middleware/validation on these (req.body is raw parsed JSON).
- Partner carrier routes: `src/api/partners/orders/[id]/{shiprocket-label,shiprocket-attach-awb}/route.ts` — scope via `validatePartnerOrderOwnership(auth_context,orderId,scope)` from `src/api/partners/helpers.ts` (404 if not owned). Existing per-fulfillment carrier UI routes: `partners/orders/[id]/fulfillments/[fulfillmentId]/{label,tracking,pickup,shipment,mark-as-delivered}`. EVERY partner subroute needs its own matcher in `src/api/middlewares.ts` (createCorsPartnerMiddleware + authenticate("partner",["session","bearer"])).
- Admin Design-Orders UI: `src/admin/routes/design-orders/[id]/page.tsx` (OrderSection has Convert/Generate-Label/Attach-AWB/courier-picker) + hooks `src/admin/hooks/api/design-orders.ts` (useShiprocketRates, useGenerateShiprocketLabel w/ preferred_courier_id, useAttachShiprocketAwb). Detail route param `:id` = design lineItemId (`cali_...`); list `/admin/designs/orders` returns `design_orders[].items[].line_item_id`.
- Partner-ui carrier hooks: `apps/partner-ui/src/hooks/api/shiprocket.tsx`; order-fulfillment action row at `apps/partner-ui/src/routes/orders/order-detail/components/order-fulfillment-section/order-fulfillment-section.tsx` ~L627 (Download Label / Schedule Pickup / Mark Delivered / Mark Shipped — where #639 buttons go).
- To add a partner mirror of an admin order route: copy the admin route, add `validatePartnerOrderOwnership` as line 1 of the handler, add a matcher to middlewares.ts. Relative depth from `partners/orders/[id]/<route>/route.ts`: helpers=`../../../helpers`, workflows=`../../../../../workflows`.

## Helper-file convention (#578 — lib/ dissolution)
- Target pattern: co-locate a pure helper as `<name>-lib.ts` next to its workflow/route, OR at module root.
  Reserve a `lib/` dir ONLY for `src/lib/` (app-wide) + `admin/lib/` (SPA infra). KEEP those two.
- DONE (PR #650, module dirs → module root, plain move): `modules/{analytics,messaging,partner_billing}/lib/*` now at module root.
- DONE (PR #651, email dir → `*-lib.ts` next to send-*.ts): the 4 email helpers now live at
  `workflows/email/workflows/{partner-task-email,partner-production-run-email,order-canceled-customer-email,region-request-admin-email}-lib.ts`
  (tests in `workflows/email/workflows/__tests__/*-lib.unit.spec.ts`). ⚠ The stale `workflows/email/lib/...` paths in the
  "Partner emails" / #576 entries above refer to PRE-#651 locations — once #651 merges, read `workflows/email/workflows/<name>-lib.ts`.
- #578 is fully built (both PRs OPEN, independent). Both module dirs and the email dir now follow the convention.
- Recipe for a lib/ dissolution: `git mv` files up + move `__tests__`; fix (a) external importers (drop `/lib/`),
  (b) moved files' OWN `../` imports IF depth changed (module-root move = one shallower; email `lib/`→sibling `workflows/`
  is SAME depth = no internal-import edits), (c) importers under `apps/backend/integration-tests/` (not just `src/`).
  Verify `npx tsc --noEmit -p tsconfig.json` baseline = 69 (0-new).

## Partner tax-ID fallback (#348)
- Partner model `src/modules/partner/models/partner.ts` — added typed `tax_id`+`tax_id_type`
  (nullable text). Migration pattern = hand-written `add column if not exists`
  (`migrations/Migration20260622120000.ts`). Partner had NO tax fields before, only `metadata`.
- Pure resolver: `src/modules/partner/tax-id-lib.ts#resolvePartnerTaxId` (partner-ID→platform
  brand-ID→none), `normalizeBrand` (JYT/KHT, default JYT), `getPlatformTaxIds(env)` reads
  `JYT_PLATFORM_TAX_ID`/`KHT_PLATFORM_TAX_ID`. Unit spec `__tests__/tax-id-lib.unit.spec.ts`.
- Platform/company identity (tax_id, legal_name, registration_number) = `src/modules/company/models/company.ts`.
- **Tax IDs sink into LABELS, not invoices** (no invoice-PDF gen exists).
- **Slice B DONE (PR #654)** — country-aware wiring:
  - Lib extended (same `tax-id-lib.ts`): `resolveBrandForCountry` (IN→JYT, `EU_VAT_COUNTRY_CODES`→KHT),
    `getPlatformTaxIdConfig(env)`, `resolveTaxIdForCountry`. Env RENAMED `PLATFORM_TAX_ID_JYT`/`_KHT`(+`_TYPE_*`).
  - I/O helper `src/modules/shipping-providers/seller-tax-id.ts`: `resolveSellerTaxIdForOrder(container,orderId,country)`
    (best-effort partner↔order link→partner.tax_id→pure resolver; never throws) + `resolvePlatformTaxIdForCountry(country)`.
  - Sinks: `provider-interface.ts CreateShipmentInput.tax_id` → `delhivery/adapter.ts seller_gst_tin`;
    `delhivery/service.ts` direct path seller_gst_tin (platform-only); `workflows/orders/shiprocket-shipment.ts`
    buildCreateShipmentInput opts.taxId (partner-aware); `pickup-locations.ts` registerPickupLocation gstin (platform-only).
  - Config: `module.exports.platformTaxIds=getPlatformTaxIdConfig(process.env)` in medusa-config.ts + .prod.ts.
- To get a partner FROM an order id: query `partnerOrderLink.entryPoint` (import `../../links/partner-order`)
  filter `{order_id}` fields `["partner_id"]`, then query entity `"partner"` by id. See seller-tax-id.ts.
- Partner service methods: `createPartners` (plural) / `retrievePartner` (singular). Resolve via
  `container.resolve(PARTNER_MODULE)` (PARTNER_MODULE = "partner").

## Design module — adding fields / brief (#604)
- Model: `src/modules/designs/models/design.ts` (`model.define("design", …)`). Service `service.ts` auto-wires `Design` — adding a column needs NO service change.
- To add a column: edit the model + hand-write `migrations/Migration<ts>.ts` (`alter table if exists "design" add column if not exists …`; the auto-gen `create table if not exists` is a no-op on prod) + add the col to `migrations/.snapshot-design.json` (additive, mirror an existing col's JSON shape; enums = type `text` mappedType `enum` with `enumItems`, no check constraint). **bigNumber ⇒ also add `raw_<col>` jsonb** in BOTH migration and snapshot.
- Module-level test pattern (slice with no validators yet): `integration-tests/http/<name>.spec.ts` using `setupSharedTestSuite`/`getSharedTestEnv` → `getContainer().resolve(DESIGN_MODULE)` → `createDesigns/updateDesigns/retrieveDesign` directly (bypasses admin/partner Zod). `DESIGN_MODULE` from `src/modules/designs`.
- #604 brief slice-A columns (PR #653): concept_theme, persona, competitors, price_point, design_budget(+raw_design_budget). Next: validators in `src/api/admin/designs/validators.ts` + `src/api/partners/designs/validators.ts`.

## Platform tax-identity table (#348 slice B, PR #656)
- New module `src/modules/platform-tax-identity/`: `models/platform-tax-identity.ts` (model.define, `country_codes: model.array()`→text[]), `service.ts`, `index.ts` (`PLATFORM_TAX_IDENTITY_MODULE="platform_tax_identity"`), `migrations/Migration20260622140000.ts` (hand-written create-table-if-not-exists + idempotent seed JYT 07AAGCJ0494A1ZV/IN, KHT 40203579735/27 EU), `resolve-lib.ts` (PURE `resolvePlatformTaxIdentity`/`resolvePlatformTaxIdString`/`EU_VAT_COUNTRY_CODES`/`normalizeCountryCode`). Registered in medusa-config.ts + .prod.ts.
- Seller tax-ID I/O: `src/modules/shipping-providers/seller-tax-id.ts` `resolveSellerTaxIdForOrder(container,orderId,country)` (partner-own→platform-by-country→none) + `resolvePlatformTaxIdForCountry(container,country)`. Loads rows via MODULE SERVICE (not query.graph — custom module not in remote-query index).
- To add a platform tax row/brand: insert into `platform_tax_identity` (admin UI = deferred B3). To change a label sink: `provider-interface.ts CreateShipmentInput.tax_id` → `delhivery/adapter.ts seller_gst_tin`; `workflows/orders/shiprocket-shipment.ts` (gstin, partner-aware); `pickup-locations.ts registerShiprocketPickup` (gstin, platform-only). Delhivery `service.ts createFulfillment` direct path has NO container (can't query table).

## Design brief admin API (#604 slice B, PR #657)
- Slice-A brief columns on `src/modules/designs/models/design.ts`: `concept_theme` text, `persona` json, `competitors` json, `price_point` enum(luxury|mid_market|budget), `design_budget` bigNumber(+`raw_design_budget`), shared `cost_currency`.
- Brief routes: `src/api/admin/designs/[id]/brief/{route.ts,validators.ts}` — GET/POST(replace)/PUT(partial). Registered in `middlewares.ts` (2 matchers POST+PUT under the `/admin/designs/:id` block; GET needs no body validation).
- **Recipe — add any new typed design column to the write path:** NO workflow edit needed. `updateDesignStep` (`src/workflows/designs/update-design.ts`) spreads `...designFields` and persists every non-undefined key via `updateDesigns`. Just add it to a route's input + a validator. Reads: `refetchDesign` (`src/api/admin/designs/helpers.ts`) always selects `*` so scalar columns return without touching `DesignAllowedFields`.
- Admin HTTP integration-spec auth: `createAdminUser(container)` + `getAuthHeaders(api)` from `integration-tests/helpers/create-admin-user`.

## Partner-storefront SEO / website config (#349, #377)
- Backend Website model: `src/modules/website/models/website.ts` — has `analytics_provider`(in_house|custom|off), `analytics_custom_head`, `analytics_custom_body_end`, `theme`, `domains`. NO seo/verification field yet.
- Public website API (storefront `getWebsite()` source): `src/api/web/website/[domain]/route.ts` — returns a CURATED `publicWebsiteData` (id/name/domain/theme/favicon/analytics/pages). **New columns are NOT auto-exposed — must be added to this object.** Partner write path: `src/api/partners/storefront/website/analytics/route.ts`.
- SEO lives in the `apps/storefront-starter` SUBMODULE (Next.js, pushed to its own `main`): JSON-LD `src/modules/products/templates/product-jsonld.ts` + `src/lib/util/breadcrumb-jsonld.ts` + `src/app/layout.tsx` (Org/WebSite); `src/app/sitemap.ts`; `src/app/robots.ts`; canonical/hreflang `src/lib/util/seo.ts` + `getBaseURL()` in `src/lib/util/env.ts`. **All already shipped — #349 JSON-LD is DONE.**
- To add Search Console meta-tag verification (#349 PR-1/PR-2): add `seo_head`/`google_site_verification` column to Website model + add-col migration, expose in the `[domain]/route.ts` `publicWebsiteData`, render in storefront `layout.tsx <head>` (unconditional). Gated on a product decision — see `apps/docs/notes/349_PARTNER_STOREFRONT_SEO_ANALYSIS.md`.
- NOTE: `apps/storefront/`, `apps/storefront-starter/`, and `apps/backend/.medusa/server/src/` all carry decoy `modules/website` copies — backend truth is `apps/backend/src/` (map's `src/...` paths = relative to apps/backend).

## Shipping-provider abstraction (#649 / #31 / #404)
- Module `src/modules/shipping-providers/`: `provider-interface.ts` (normalized `ShippingProviderClient`:
  getRates/createShipment/getLabel/track/cancelShipment/schedulePickup/registerPickupLocation/
  listPickupLocations/checkServiceability/normalizeWebhook), `resolver.ts`
  (`resolveShippingProvider(container,carrier)`, `SUPPORTED_CARRIERS=["delhivery","shiprocket"]`,
  `findShippingPlatform`=first active `SocialPlatform` category:"shipping" — NO partner scope).
- **6 adapters** registered as Medusa fulfillment providers in `index.ts` via
  `ModuleProvider(Modules.FULFILLMENT,{services:[...]})`: delhivery/shiprocket/dhl/ups/fedex/auspost
  (each `<carrier>/service.ts` extends `AbstractFulfillmentProviderService`, delegates to `<carrier>/client.ts`).
- Native fulfillment-provider registration = `medusa-config.prod.ts:273` `@medusajs/medusa/fulfillment`
  `providers:[...]` — **env-gated at boot** (`process.env.X ? [...] : []`). Base `medusa-config.ts` has FEWER.
- **Storefront rate bridge ALREADY exists**: `shiprocket/service.ts:calculatePrice()` maps Medusa calc-option
  ctx → `client.getRates()`; returns recommended amount (tax-inclusive). NOT attached to any service zone →
  checkout never exercises it; returns `amount:0` on bad pin/error (silent free shipping).
- Creds: untyped `SocialPlatform.api_config` JSON, `<field>_encrypted` via `ENCRYPTION_MODULE`
  (`resolver.ts:readSecret`); admin UI `src/admin/components/social-platforms/shipping-provider-fields.tsx`.
- Carrier routes: admin `src/api/admin/orders/[id]/{shiprocket-label,shiprocket-rates,shiprocket-attach-awb}`,
  `src/api/admin/stock-locations/[id]/shiprocket-pickup`; partner `src/api/partners/orders/[id]/{shiprocket-label,shiprocket-attach-awb}` (#639, platform account).
- **#649 analysis (PR #663)**: `apps/docs/notes/649_GLOBAL_SHIPPING_PROVIDER_ABSTRACTION_ANALYSIS.md` — gaps =
  per-tenant config model + runtime registration + service-zone rate wiring + partner scope; 6-PR plan; gated on
  a per-tenant-accounts-vs-platform-account product decision. Prior docs: SHIPPING_PROVIDERS.md, 404_*, 639_*.

## #659 AI VP of Marketing (analysis-mode daemon → per-slice specs in apps/docs/marketing/)
- Spec+report MERGED (PR #665): `apps/docs/marketing/{ai-vp-marketing-early-stage-spec.md, AI_VP_MARKETING_JYT_ADAPTATION.md}`.
  Report §12 = the net-new build list; daemon writes ONE `NN_TOPIC_SPEC.md` per slice, 1 PR each, off main, NO merge.
- **Slice 1 spec = PR #666**: `apps/docs/marketing/01_MARKETING_MODULE_AND_MODELS_SPEC.md` (new `marketing` module + 5 typed
  models: metric_snapshot/outreach/draft/manual_override/ideas_log + 1 migration). One Goal is a NON-blocker (snapshot =
  goal-agnostic named-metric rows). Next slices: 2=ideas-email+hallucination-guard, 3=daily-refresh job+headline strip, 4=outreach/WinbacksView.
- **NEW-MODULE recipe (grep-verified 2026-06-23), mirror `src/modules/ops_audit/`:** `index.ts` (`Module(MODULE,{service})`+const) +
  `service.ts` (`MedusaService({...models})` → auto CRUD `create/listAndCount/retrieve/update<Model>s`, Medusa pluralizes class name) +
  `models/<m>.ts` (`model.define`) + `migrations/Migration<stamp>.ts` (`create table if not exists` per model, hand-emit
  created_at/updated_at/deleted_at + soft-delete partial index + each `.indexes()` as CREATE [UNIQUE] INDEX IF NOT EXISTS).
  Register in BOTH `medusa-config.ts` (ops_audit ~L403, analytics ~L390) AND `medusa-config.prod.ts` (ops_audit ~L465, analytics ~L387); NOT .dev.ts.
- **model.define refs:** json+indexes+default = `modules/analytics/models/analytics-daily-stats.ts`; plain cols+json payloads =
  `modules/ops_audit/models/ops-maintenance-run.ts`; `model.enum([...])` (→ `text check(...) default`) = `modules/ad-planning/models/{ab-experiment,segment-member,sentiment-analysis}.ts`.
- **Scheduled job shape** = `src/jobs/aggregate-daily-analytics.ts`: default-export `async (container)=>{}` + `export const config={name,schedule:"cron"}`;
  idempotent daily upsert = list-then-create/update (it `listAnalyticsDailyStats({website_id,date})` then create-or-update).
