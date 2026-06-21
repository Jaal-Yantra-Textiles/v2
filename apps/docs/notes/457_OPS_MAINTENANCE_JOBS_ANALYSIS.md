# Ops Maintenance Jobs — Behaviour Analysis (#457 / #508)

## Purpose

The maintenance-jobs module registers and runs admin API-driven "data plumbing" jobs — guarded, idempotent data-correction actions that follow a safe-by-default dry-run → apply lifecycle (`apps/backend/src/api/admin/ops/maintenance-jobs/registry.ts:25-37`). It surfaces corrections that previously required raw curl or one-off scripts as discoverable, audited API endpoints. The module also supports **batch runs** (Data Plumbing v2, #508) where multiple jobs run sequentially under a single `dry_run` flag.

## The Registry

### Location and shape

All jobs are registered in **`apps/backend/src/api/admin/ops/maintenance-jobs/registry.ts`**.

The `MaintenanceJob` interface (`registry.ts:69-79`):
```typescript
type MaintenanceJob = {
  id: string          // unique string identifier, used in URL params
  label: string       // human-readable short name
  description: string // full description for the list endpoint + UI
  params: MaintenanceJobParam[]  // param descriptors for discovery
  run: (container, opts: { dry_run: boolean; params: Record<string, unknown> })
    => Promise<MaintenanceJobResult>
}
```

### Supporting types

- **`MaintenanceJobParam`** (`registry.ts:62-67`): descriptor with `name`, `type` ("string"|"number"|"boolean"), `required`, `description`.
- **`MaintenanceJobResult`** (`registry.ts:47-60`): returned by every job — `job_id`, `dry_run`, `applied`, `summary`, `changes: MaintenanceChange[]`, optional `errors`.
- **`MaintenanceChange`** (`registry.ts:39-45`): one atomic change — `entity`, `id`, optional `field`, `before`, `after`.
- **`getMaintenanceJob(id)`** (`registry.ts:2986-2987`): lookup helper used by the run route and batch executor. O(1) linear scan over the array.

### Registered jobs (`registry.ts:2970-2984`)

13 jobs as of this writing; the array is the single source of truth:

| id | label |
|----|-------|
| `recalculate-design-cost` | Recalculate design cost |
| `recalculate-design-cost-bulk` | Recalculate design cost (bulk) |
| `correct-production-run-cost` | Correct a production run's cost |
| `backfill-inventory-unit-cost` | Backfill inventory unit cost |
| `backfill-design-energy-costs` | Backfill design energy & labor costs |
| `prune-ops-audit-runs` | Prune ops audit log |
| `backfill-partner-order-currency` | Backfill partner order currency |
| `repair-partner-region-links` | Repair partner region links |
| `resync-product-partner-landing-url` | Resync product partner landing URL |
| `backfill-consumption-log-production-run-id` | Backfill consumption log production run id |
| `repair-inventory-raw-material-links` | Repair inventory ↔ raw-material links |
| `backfill-partner-order-fees` | Backfill partner order fees |
| `backfill-stats-panel-window` | Backfill stats panel date window |

### The `route.ts` — listing endpoint

**`GET /admin/ops/maintenance-jobs`** (`apps/backend/src/api/admin/ops/maintenance-jobs/route.ts:11-21`): returns `{ jobs: [{ id, label, description, params }], count }`. No auth guard visible in the route itself (assumes Medusa admin middleware).

---

## Entry Points (routes)

| Method | Path | File | Description |
|--------|------|------|-------------|
| `GET` | `/admin/ops/maintenance-jobs` | `route.ts:11` | List all jobs |
| `POST` | `/admin/ops/maintenance-jobs/:id/run` | `[id]/run/route.ts:18` | Run one job |
| `GET` | `/admin/ops/maintenance-jobs/runs` | `runs/route.ts:19` | Audit history index |
| `GET` | `/admin/ops/maintenance-jobs/runs/:id` | `runs/[id]/route.ts:14` | Single run detail |
| `POST` | `/admin/ops/maintenance-jobs/batches` | `batches/route.ts:31` | Run a batch |
| `GET` | `/admin/ops/maintenance-jobs/batches` | `batches/route.ts:122` | Batch history index |
| `GET` | `/admin/ops/maintenance-jobs/batches/:id` | `batches/[id]/route.ts:16` | Single batch detail + children |

---

## Job Lifecycle

### Per-job (`POST /admin/ops/maintenance-jobs/:id/run`)

**File:** `apps/backend/src/api/admin/ops/maintenance-jobs/[id]/run/route.ts`

1. **Lookup:** `getMaintenanceJob(req.params.id)` (`[id]/run/route.ts:19`). Unknown id → `NOT_FOUND` (MedusaError, HTTP 404).
2. **Validate body:** Uses `OpsMaintenanceRunSchema` from `validators.ts:8-15` — accepts `{ dry_run?: boolean, params?: Record<string, string, any> }`. `dry_run` defaults to `true` (`[id]/run/route.ts:28`).
3. **Run:** `job.run(req.scope, { dry_run, params })` (`[id]/run/route.ts:31`). Per-job params are validated inside each job's own zod schema inside `run()` (e.g., `recalcParamsSchema` at `registry.ts:181-183`). Invalid params → `INVALID_DATA` MedusaError (HTTP 400).
4. **Audit:** builds an audit row via `buildAuditRow` (`audit.ts:26-44`) and persists to `ops_maintenance_run` via `audit.createOpsMaintenanceRuns(row)` (`[id]/run/route.ts:43-44`). The persist is **best-effort** — wrapped in try/catch with `logger.error`, never rolls back the correction (`[id]/run/route.ts:39-47`).
5. **Response:** `{ result, audit }` (`[id]/run/route.ts:49-59`).

### Guards

- Unknown job id → 404 (`[id]/run/route.ts:20-24`).
- Invalid params within a job → `INVALID_DATA` (400) thrown by the job's zod schema (e.g., `registry.ts:205-210`).
- Per-entity jobs (single-entity, e.g., `recalculateDesignCostJob`) throw `NOT_FOUND` / `NOT_ALLOWED` on bad entity ids — these percolate as HTTP errors (`registry.ts:57-58` comment, `registry.ts:493-504`: cancelled-run guard).
- Batch jobs (e.g., `recalculateDesignCostBulkJob`) catch per-entity failures and record them in `errors[]` instead of aborting (`registry.ts:344-346`).

### Batch runs (`POST /admin/ops/maintenance-jobs/batches`)

**File:** `apps/backend/src/api/admin/ops/maintenance-jobs/batches/route.ts`

1. **Validate body:** `OpsMaintenanceBatchSchema` (`validators.ts:62-78`) — `{ name?, dry_run?, stop_on_error?, jobs: [{ job_id, params? }] }`. Max 20 jobs per batch (`validators.ts:50`).
2. **Up-front validation:** all job ids are checked against the registry before any run (`batches/route.ts:45-53`). Unknown ids → 400.
3. **Sequential execution:** `runBatch(req.scope, { jobs, dry_run, stop_on_error })` (`batches/route.ts:59`). The executor (`batch-executor.ts:63-94`) loops over jobs sequentially, catching per-job errors and recording them as `ok: false` outcomes. `stop_on_error=true` breaks after the first failure.
4. **Rollup:** `buildBatchRollup(outcomes, ...)` (`batch-audit.ts:50-89`) counts applied/failed/changed/errors across children.
5. **Audit:** persists one `ops_maintenance_batch` parent + N child `ops_maintenance_run` rows (with `batch_id` + `job_index`), best-effort (`batches/route.ts:74-94`).
6. **Response:** `{ batch: { id, ...rollup, ran_at }, results: [...] }` (`batches/route.ts:96-109`).

### Dry-run → apply pattern

The convention demonstrated by every job (e.g., `recalculateDesignCostJob` at `registry.ts:191-234`):
- Compute the diff (pure functions keep this container-free and testable).
- If `!dry_run && changes.length > 0`, write.
- Return `applied: !dry_run && changes.length > 0`.
- The summary string describes what *would* happen vs. what *did* happen.

This is the invariant: **dry-run never writes; apply only writes if there are changes.** Re-running an already-corrected entity produces `changes.length === 0` → no-op.

---

## Data Models

### `ops_maintenance_run` (audit log)

**`apps/backend/src/modules/ops_audit/models/ops-maintenance-run.ts:16-30`**

| Column | Type | Notes |
|--------|------|-------|
| id | auto PK | |
| job_id | text | The job identifier |
| actor_id | text | From `auth_context.actor_id` |
| dry_run | boolean | |
| applied | boolean | |
| change_count | number | `changes.length` |
| error_count | number | `errors.length` |
| summary | text | Human-readable result |
| params | json | The params passed to the job |
| changes | json | Full `MaintenanceChange[]` array |
| errors | json | `errors[]` array |
| batch_id | text, nullable | Parent batch id (#508) |
| job_index | number, nullable | Position within the batch (#508) |

### `ops_maintenance_batch` (batch parent)

**`apps/backend/src/modules/ops_audit/models/ops-maintenance-batch.ts:13-25`**

| Column | Type | Notes |
|--------|------|-------|
| id | auto PK | |
| name | text | Batch label |
| actor_id | text | |
| dry_run | boolean | |
| stop_on_error | boolean | |
| job_count | number | Total children attempted |
| applied_count | number | Children that actually wrote |
| failed_count | number | Children that threw |
| change_count | number | Sum of child changes |
| error_count | number | Sum of child per-entity errors |
| summary | text | Human-readable rollup |

### Service

**`apps/backend/src/modules/ops_audit/service.ts:12-15`** — `MedusaService({ OpsMaintenanceBatch, OpsMaintenanceRun })` — auto-generates CRUD methods (e.g., `createOpsMaintenanceRuns`, `listAndCountOpsMaintenanceRuns`, `retrieveOpsMaintenanceRun`, `deleteOpsMaintenanceRuns`, etc.).

---

## Validators (input schemas)

All in **`apps/backend/src/api/admin/ops/maintenance-jobs/validators.ts`**:

- **`OpsMaintenanceRunSchema`** (`validators.ts:8-15`) — body for `POST :id/run`.
- **`OpsMaintenanceRunsQuerySchema`** (`validators.ts:34-41`) — query for `GET /runs`, filterable by `job_id`, `dry_run`, `applied`, `batch_id`. The `batch_id` sentinel `"null"`/`"none"` filters to single-job runs only (`runs/route.ts:29-31`).
- **`OpsMaintenanceBatchSchema`** (`validators.ts:62-78`) — body for `POST /batches`. Max 20 jobs, each with `job_id` + optional `params`.
- **`OpsMaintenanceBatchesQuerySchema`** (`validators.ts:89-94`) — query for `GET /batches`, filterable by `dry_run`, `actor_id`.

---

## Audit Builders (pure mappers)

### `buildAuditRow` (`audit.ts:26-44`)

Maps `MaintenanceJobResult` + `actorId` + `params` → `OpsMaintenanceRunRow`. Defaults `errors` to `[]` for single-entity jobs.

### `buildBatchRollup` (`batch-audit.ts:50-89`)

Maps `BatchChildOutcome[]` + metadata → `OpsMaintenanceBatchRow`. Counts: `job_count`, `applied_count` (children with `ok && result.applied`), `failed_count` (`!ok`), `change_count` (sum of child changes), `error_count` (sum of child errors).

### `buildBatchChildRow` (`batch-audit.ts:110-143`)

Maps one `BatchChildOutcome` → `OpsMaintenanceBatchChildRow` (stamped with `batch_id` + `job_index`). For a failed child (`!ok`), produces a synthetic zero-change row with the error message in `errors`.

---

## Batch Executor

**`apps/backend/src/api/admin/ops/maintenance-jobs/batch-executor.ts`**

- **`runBatch`** (`batch-executor.ts:63-94`): sequential executor. Each child runs in a try/catch — a throw is recorded as `{ job_id, ok: false, error }` and the loop continues (or breaks if `stop_on_error=true`).
- **`defaultRunSingleJob`** (`batch-executor.ts:33-46`): resolves from registry and runs.
- **`RunSingleJob`** (`batch-executor.ts:22-26`): injectable function type — `runBatch` accepts `runJob` for unit testing.

---

## How to Add a NEW Job

This is the recipe for delegating future ops maintenance jobs. Follow it mechanically.

### 1. Create pure diff/compute functions

In **`apps/backend/src/api/admin/ops/maintenance-jobs/registry.ts`**, add the following BEFORE the `MAINTENANCE_JOBS` array (or in a co-located module if large — but all existing jobs are defined inline):

```
a) A params zod schema (e.g., `myJobParamsSchema`).
b) A pure diff function (e.g., `diffMyJobFields`) that returns `MaintenanceChange[]`.
   - Must accept explicit before/after values, NOT a container/DB — this is what makes it unit-testable.
c) A pure summary builder (e.g., `summarizeMyJob`) that returns a human-readable string.
d) (Optionally) a hard-cap constant (e.g., `MAX_MY_JOB_SCAN`) to bound blast radius.
```

### 2. Define the job object

Add a `const myJob: MaintenanceJob = { id, label, description, params: [...], run: async (container, { dry_run, params }) => { ... } }` in **`registry.ts`** after the pure functions. The `run` method must:

```
a) Parse + validate params with the zod schema → `INVALID_DATA` on failure.
b) Resolve services from `container`.
c) Compute the diff (call your pure function).
d) If `!dry_run && changes.length > 0`, write via the module service.
e) Return `{ job_id, dry_run, applied, summary, changes, errors? }`.
```

### 3. Register in the array

Append the job object to the `MAINTENANCE_JOBS` array at **`registry.ts:2970-2984`**.

That is all. The `POST /admin/ops/maintenance-jobs/:id/run` route, `GET /admin/ops/maintenance-jobs` list, audit-logging, and batch execution all work automatically — the registry is the single integration point.

### 4. (Optional but recommended) Write unit tests

Add a test file in **`apps/backend/src/api/admin/ops/maintenance-jobs/__tests__/`** testing:

- The pure diff function (input → expected `MaintenanceChange[]`).
- The summary builder.
- The params schema (valid/invalid inputs).
- See existing tests for the pattern: e.g., `__tests__/backfill-stats-panel-window.unit.spec.ts`, `__tests__/backfill-consumption-log-production-run-id.unit.spec.ts`, `__tests__/repair-partner-region-links.unit.spec.ts`.

### Concrete example: `recalculateDesignCostJob`

The simplest single-entity job at **`registry.ts:191-234`**:

- `recalcParamsSchema` (`registry.ts:181-183`): validates `design_id` is present.
- `recomputeDesignCost` (`registry.ts:125-157`): loads design + runs estimate workflow (shared with bulk job).
- `diffCostFields` (`registry.ts:86-109`): pure diff of three cost columns. Exported and unit-tested.
- `persistDesignCost` (`registry.ts:160-179`): writes via `designService.updateDesigns`.
- `run()`: validates params, calls `recomputeDesignCost`, diffs, conditionally persists, returns result.

---

## Gotchas / Invariants

1. **Audit persist is best-effort** (`[id]/run/route.ts:39-47`, `batches/route.ts:72-94`): A correction that succeeds but fails to audit is NOT rolled back. The audit write is wrapped in a try/catch that only logs.
2. **Batch run never fails the HTTP request for per-job errors** (`batch-executor.ts:63-94`): Per-job throws are caught and recorded as failed outcomes. The only time a batch route throws is an unknown job id (validated up-front, `batches/route.ts:45-53`).
3. **Single-entity jobs throw HTTP errors; batch jobs record per-entity errors** (`registry.ts:57-58`): A single-entity job like `recalculateDesignCostJob` throws `NOT_FOUND` if the entity is missing → 404. Its bulk counterpart catches and records in `errors[]`.
4. **dry_run defaults to `true`** (`[id]/run/route.ts:28`, `validators.ts:8-9`): Safe by default — a body of `{}` previews without writing.
5. **`batch_id` sentinel for run history** (`runs/route.ts:29-31`): Passing `batch_id=null` or `batch_id=none` filters to single-job runs (those without a parent batch). This prevents double-counting in the "All runs" tab.
6. **Job ids are validated up-front in batch routes** (`batches/route.ts:45-53`): An unknown id fails the entire batch before any job runs — it's considered a caller mistake, distinct from a job that runs and then fails.
7. **`OpsMaintenanceRunSchema` only validates the envelope** (`validators.ts:8-15`): Per-job params are validated by each job's own zod schema inside `run()`. This means a malformed param is only caught when the job runs, not by the route validator.
8. **`MedusaError` types map to HTTP status codes**: `NOT_FOUND` → 404, `INVALID_DATA` → 400, `NOT_ALLOWED` → 403, `UNEXPECTED_STATE` → 500. Jobs can throw these and get the correct HTTP status for free.

---

## Open Questions / (unverified)

- Actor extraction `(req as any).auth_context?.actor_id ?? "unknown"` relies on the Admin API auth middleware having populated `auth_context`. The actual middleware setup is not visible in these files.
- No rate limiting, locking, or concurrency guard is applied — two concurrent requests for the same job could race (though the jobs are idempotent, duplicate writes are wasteful).
- The `MedusaService` auto-generated methods (`listAndCountOpsMaintenanceRuns`, `retrieveOpsMaintenanceBatch`, `deleteOpsMaintenanceRuns`, etc.) are not explicitly visible — only their names are implied by the `@medusajs/framework/utils` `MedusaService` pattern (`service.ts:12-15` + `registry.ts:1347,1362` usage).
