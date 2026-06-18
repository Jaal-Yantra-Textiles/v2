# Data Plumbing v2 — batch runs + redesigned run layout + more hard-to-reach jobs

Issue: **#508**. Builds on the #457 guarded maintenance-jobs registry, the `ops_audit`
durable run log (#480), and the Settings → Data Plumbing console (#507).

> **Design-first chunk.** This doc proposes the data model, execution semantics, UI
> redesign, and a ranked candidate-job list. The open decisions are surfaced as a
> comment on #508 for the user to steer (same loop used on #485/#494). No backend was
> built in this chunk — build proceeds incrementally only after the decisions land.

## Where we are today (v1, shipped)

- **Registry** (`api/admin/ops/maintenance-jobs/registry.ts`): `MAINTENANCE_JOBS[]` of
  guarded jobs. Each job is `{ id, label, description, params[], run(container,{dry_run,params}) }`
  returning `MaintenanceJobResult { job_id, dry_run, applied, summary, changes[], errors?[] }`.
  Safe-by-default: `dry_run` defaults true; apply only writes when `dry_run=false`.
- **Run endpoint**: `POST .../maintenance-jobs/:id/run` — runs ONE job, logs the actor,
  best-effort persists one `ops_maintenance_run` audit row.
- **History**: `GET .../maintenance-jobs/runs` — paginated flat list of `ops_maintenance_run`
  rows, newest first, filter by job_id / dry_run / applied.
- **Audit model** (`modules/ops_audit/models/ops-maintenance-run.ts`): one row per `:id/run`
  call, stores the full `changes`/`errors`/`params` JSON.
- **UI** (#507): Settings → Data Plumbing — one job at a time → Preview (dry-run) → Apply
  → flat run-history table.

v1 is **job-at-a-time**. v2 makes it **batch-oriented**: assemble several jobs into one
named run, preview/apply them together, and group results under the run.

---

## (a) Batch-run data model

### Decision — parent `ops_maintenance_batch` table + nullable `batch_id` on `ops_maintenance_run`  ✅ recommended

Add a new model in the **same `ops_audit` module**:

```ts
// modules/ops_audit/models/ops-maintenance-batch.ts
const OpsMaintenanceBatch = model.define("ops_maintenance_batch", {
  id: model.id().primaryKey(),
  name: model.text(),                 // operator-supplied label for the run
  actor_id: model.text(),
  dry_run: model.boolean(),           // batch-level: whole batch is preview OR apply
  stop_on_error: model.boolean(),     // execution policy (see (b))
  job_count: model.number(),          // # child jobs requested
  applied_count: model.number(),      // # child runs that actually wrote (applied=true)
  failed_count: model.number(),       // # child jobs that errored out
  change_count: model.number(),       // rollup: total changes across children
  error_count: model.number(),        // rollup: total per-entity errors across children
  summary: model.text(),              // rollup sentence
})
```

…and add **one nullable column** to the existing run model:

```ts
const OpsMaintenanceRun = model.define("ops_maintenance_run", {
  // …existing columns unchanged…
  batch_id: model.text().nullable(),  // NEW — null for legacy/single-job runs
  job_index: model.number().nullable() // NEW — order within the batch (0-based)
})
```

We **do not** add a hard DML relation (`belongsTo`); a denormalized `batch_id` text
column is enough — the run-history read filters `{ batch_id }` to fetch a batch's
children, and the parent persists its own rollup so the list view never recomputes.

### Why a parent table, not just a `batch_id` column

| | parent table + `batch_id` (chosen) | bare `batch_id` column only |
|---|---|---|
| Batch metadata (name, actor, rollup, policy) | one row, queried directly | denormalized onto every child OR recomputed on every read |
| History list = list of batches | `listOpsMaintenanceBatches` paginated | must `GROUP BY batch_id` + re-aggregate children each read |
| Single-job runs (legacy + quick path) | `batch_id = null`, untouched | mixed null/grouped rows in one query — awkward |
| Rollup fidelity (failed/applied counts) | persisted on the batch | recomputed, can drift from children |

### Backward compatibility

- Existing `ops_maintenance_run` rows get `batch_id = NULL`; the v1 `:id/run` endpoint
  and `GET /runs` keep working **unchanged**. A single-job run is just an un-batched run.
- Migration is purely **additive** (`add column if not exists` ALTERs + a new
  `create table if not exists` for the batch) — hand-write the ALTERs per the
  create-if-not-exists hazard (a new column inside the existing table's create migration
  never lands on prod's already-created table). New table can use the generated migration.

---

## (b) Execution semantics

| Question | Decision | Rationale |
|---|---|---|
| **Sequential vs parallel** | **Sequential** | Jobs share the container/DB and many scan+write overlapping entities (recalc-design-cost and backfill-energy-costs both touch `design`). Sequential = deterministic order, bounded resource use (each job already runs synchronous `query.graph` loops), clean per-job result. Parallel adds contention + nondeterministic interleaving with no real win for low-frequency operator ops. |
| **dry-run granularity** | **One batch-level `dry_run`** (whole batch is a preview OR an apply), NOT per-job | Matches "dry-run / apply **all** under one run." Keeps the guard mental model simple; the batch audit row has a single unambiguous `dry_run` state. Per-job mixing makes the rollup meaningless. |
| **Preview→apply flow** | Two **separate** batch calls (preview with `dry_run=true`, review, re-submit identical batch `dry_run=false`) | Stateless, mirrors the #507 single-job Preview/Apply flow exactly. Each produces its own batch audit row. (Alternative A1 below makes this one stateful batch.) |
| **Error handling** | **Continue-on-error by default**, optional `stop_on_error=true` | Jobs are independent corrections; one failure shouldn't block the rest. A child job that throws a `MedusaError` (single-entity NOT_FOUND, cancelled-run, invalid params) must be **caught per-job** and recorded as a failed child run — it must NOT abort the whole HTTP request (that's the key behavioural change from the single-job route). `stop_on_error=true` halts after the first failed child for ordered/dependent batches. |
| **Atomicity** | **No cross-job transaction** | Each job already self-manages its writes; a batch is a convenience grouping, not a DB transaction. The rollup records partial outcomes (applied_count / failed_count) honestly rather than pretending all-or-nothing. |

### Stateless batch execution (recommended — "A2")

A single endpoint executes and records a batch in one call:

```
POST /admin/ops/maintenance-jobs/batches
body: {
  name: string,
  dry_run?: boolean = true,          // batch-level guard, default preview
  stop_on_error?: boolean = false,
  jobs: [ { job_id: string, params?: object }, … ]   // ordered, 1..MAX_BATCH_JOBS
}
→ 200 { batch: {…rollup…}, runs: [ {…child MaintenanceJobResult + batch_id…}, … ] }
```

Flow: validate each `job_id` against the registry up front (unknown id → 400 before any
write); loop sequentially calling `job.run(scope, {dry_run, params})`, catching per-job
errors; persist one `ops_maintenance_batch` row + N child `ops_maintenance_run` rows
(best-effort, mirroring the v1 "audit failure never fails the request" rule); return the
grouped result. Cap `jobs.length` at a small `MAX_BATCH_JOBS` (propose **20**) to bound
the per-request blast radius (consistent with the per-job caps already in the registry).

### Alternative — stateful draft batch ("A1", flag for user)

Persist a `draft` batch first (`POST /batches` → status=draft), then `POST /batches/:id/run`
with a `dry_run` flag, re-runnable (dry-run then apply the SAME stored batch). Heavier:
adds a `status` lifecycle (draft → previewed → applied) and a saved-batch concept. The
parent-table data model above supports A1 unchanged — only the endpoint surface differs.
**Recommend A2** (stateless, parity with #507); offer A1 only if the user wants saved,
re-runnable named batches.

---

## (c) Redesigned run-layout UI (Playwright-gated, built LAST)

Replace the flat history table with grouped **run cards**. Two tabs, as in #507.

**Tab 1 — Run a batch**
- `name` text field + `dry_run` toggle (default **Preview**) + `stop_on_error` switch.
- **Job builder**: a `Select` of registry jobs (reuse #507's backend-driven list) → on add,
  render that job's dynamic param form (reuse #507's param-form) → append to an **ordered
  list** with remove + reorder (up/down). Required-param guard per job before it can be added.
- **Preview (dry-run)** runs the whole batch with `dry_run=true`; **Apply** (confirmed
  dialog) re-runs identical with `dry_run=false`.
- **Result** = batch header card (name · who/when · Preview vs Applied badge · rollup:
  `N jobs · X changes · Y errors · Z applied`) expanding into **one section per child job**
  (job label · summary · per-entity changes diff table · errors), reusing #507's per-job
  changes diff component, nested.

**Tab 2 — Run history**
- List of **batch cards** (collapsed = the header/rollup), click to expand child-job sections.
- Legacy/quick single-job runs (`batch_id = null`) shown as single-job cards (a "batch of
  one"), or behind a filter toggle. Keep the v1 **single-job quick path** (#507) available —
  the batch path is additive, for multi-job runs.
- Medusa-native styling (`--ui-*`/`--elevation-*`), Skeleton loaders, graceful-degrade if
  the `ops_audit` migration is missing (the `/runs` 500 #507 already handles).

UI is the **last** slice and MUST be Playwright-verified against live `yarn dev` with
screenshots (unit tests don't count for UI).

---

## (d) Ranked candidate "hard-to-reach API" jobs

Entities lacking clean admin CRUD, reached only via multi-hop links, or carrying
denormalized state that drifts. **Confirm scope with the user before building each** (per
the issue). Ranked by (operator value × safety × reachability-gap):

1. **`repair-partner-region-links`** — partner↔region link is the tenant source-of-truth;
   clones can bleed across tenants (see `feedback_partner_region_extend_not_lockdown`).
   Detect partners whose regions are missing/duplicated/cross-linked; dry-run lists the
   link rows it would add/remove. High value (multi-tenant correctness), pure link-table
   ops, no destructive entity writes. **Build first.**
2. **`resync-product-partner-landing-url`** — product Google-sync `link` derived from the
   owning partner storefront via product→sales_channel→store→partner pivot (#377, PR #475).
   Denormalized; drifts when a partner changes domain. Dry-run shows old→new URL per product.
   Mirrors the #377 resolver (never-throws, documented fallback chain).
3. **`backfill-consumption-log-production-run-id`** — `consumption_log.production_run_id`
   was added by a column-add ALTER (see migration-hazard memory); historical logs may be
   null. Backfill from the design↔run relationship. Denormalized FK, multi-hop. Medium value.
4. **`backfill-design-owner-partner-id`** — `design.owner_partner_id` added by ALTER
   (same hazard memory); pre-existing designs may be unowned. Derive ownership from the
   design's creating partner / linked store. Tenant-scoping correctness. Confirm derivation rule.
5. **`repair-inventory-raw-material-links`** — orphan/duplicate detection on the
   `inventory_item_raw_materials` link (the unit-cost backfill job already navigates it).
   Reports inventory items linked to deleted raw materials or doubly-linked. Pure link-table.
6. **`relink-orphan-sales-channel-store`** — sales_channel↔store↔partner pivot repair
   (the pivot the currency + landing-URL jobs both depend on). Detect sales channels with no
   store, or stores with no partner. Diagnostic-heavy; confirm the intended canonical shape first.
7. **`backfill-order-partner-currency`** *(already shipped as `backfill-partner-order-currency`, #485)* —
   listed for completeness; the template for "relabel a denormalized field via a D3 link."

> Each new job is a separate, independently-shippable backend slice with unit (pure
> helpers) + per-file integration coverage, mirroring the existing six jobs.

---

## Build order (after decisions land)

1. **Backend slice 1** — `ops_maintenance_batch` model + migration (additive) + `batch_id`/
   `job_index` ALTER on the run model. Unit: rollup builder (pure). Per-file integration:
   model create/list.
2. **Backend slice 2** — `POST .../maintenance-jobs/batches` endpoint + validator +
   per-job catch + batch/child persistence. Unit: batch executor (pure, injectable per-job
   runner — mirror the #468 injectable-execOp pattern). Per-file integration: dry-run a
   2-job batch, assert grouped result + audit rows; one failing child → continue vs stop.
3. **Backend slice 3** — `GET .../maintenance-jobs/batches` (paginated batch history) +
   `GET .../batches/:id` (batch + children). Mirror the `/runs` envelope.
4. **New jobs** — one PR each, top of the ranked list first, **scope-confirmed per job**.
5. **UI redesign** — LAST, Playwright-gated against live `yarn dev` + screenshots.

## Conventions (unchanged)

- Mirror the #457 registry + `ops_audit` patterns; **never weaken the dry-run→apply guard**.
- `container.resolve(...)` annotated `any` (TS18046). Prod build is a full tsc.
- `query.graph`: `relation.*` suffix; filters don't auto-join dot-paths.
- Hand-write `add column if not exists` ALTERs (create-if-not-exists hazard).
- Backend slices headless-testable (unit + per-file integration); UI slices Playwright-verified.
