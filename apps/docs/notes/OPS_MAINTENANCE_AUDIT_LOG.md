# Ops Maintenance Jobs — Durable Audit Log (design)

**Issue:** #457 (roadmap #33) — FIRST follow-up to the maintenance-jobs registry.
**Status:** design only (chunk 8/8 analysis). Not built — queued for next build session.
**Depends on:** PRs #470 (registry + list/run routes) and #471 (bulk job) merging first.
This slice is **stacking work**; do not build it until #470/#471 are on `main`
(otherwise the `:id/run` route it wires into doesn't exist on your base branch).

## Why

`POST /admin/ops/maintenance-jobs/:id/run`
(`apps/backend/src/api/admin/ops/maintenance-jobs/[id]/run/route.ts`) today emits
only:

1. `logger.info("[ops/maintenance] actor=… job=… dry_run=… applied=… changes=…")`
   — ephemeral, lost on log rotation, not queryable.
2. an `audit: {...}` object **in the HTTP response** — seen once by the caller,
   never persisted.

The route's own docstring already flags it: *"a durable audit-log model is a
follow-up slice."* Data-correction actions (especially `dry_run=false` applies
that mutate stored design cost) need a durable, queryable record of **who ran
what, when, against which entities, and what changed** — for incident
forensics and an Ops-console history view.

## Scope (one slice)

- New module `ops_audit` with one model `ops_maintenance_run`.
- Persist one row per `:id/run` call (both dry-run and apply).
- New `GET /admin/ops/maintenance-jobs/runs` (list, paginated, filterable by
  `job_id` / `dry_run` / `applied`) to read the history.
- Keep the existing `logger.info` line (cheap, no-DB fallback).

Out of scope: retention/pruning job, UI console, auditing non-ops endpoints.

## Model

`apps/backend/src/modules/ops_audit/models/ops-maintenance-run.ts`

```typescript
import { model } from "@medusajs/framework/utils"

const OpsMaintenanceRun = model.define("ops_maintenance_run", {
  id: model.id().primaryKey(),
  job_id: model.text(),              // e.g. "recalculate-design-cost-bulk"
  actor_id: model.text(),            // req.auth_context?.actor_id ?? "unknown"
  dry_run: model.boolean(),
  applied: model.boolean(),          // false for dry-run OR no-op apply
  change_count: model.number(),
  error_count: model.number(),       // 0 for single-entity jobs
  summary: model.text(),             // result.summary
  params: model.json(),              // the params the job ran with
  changes: model.json(),             // MaintenanceChange[] (full before/after)
  errors: model.json(),              // Array<{id,message}> | []
})

export default OpsMaintenanceRun
```

Notes:
- `model.id()` gives an auto `ops_maintenance_run_…` prefixed id + timestamps
  (`created_at`/`updated_at`) — so no separate `ran_at` column needed; use
  `created_at` as the run time.
- Store the **full** `changes` JSON. These rows are low-volume (operator-driven,
  not request-path), so fidelity > size. Add a retention job later if needed.

## Module wiring (mirror `etsysync`)

- `src/modules/ops_audit/index.ts` — `Module(OPS_AUDIT_MODULE, { service })`,
  `export const OPS_AUDIT_MODULE = "ops_audit"`.
- `src/modules/ops_audit/service.ts` — `class OpsAuditService extends
  MedusaService({ OpsMaintenanceRun }) {}`. The generated
  `createOpsMaintenanceRuns` / `listAndCountOpsMaintenanceRuns` are all we need.
- **Register in BOTH config files** (`medusa-config.ts` AND
  `medusa-config.prod.ts` — prod cp-overwrites base, see
  `reference_two_medusa_config_files`): `{ resolve: "./src/modules/ops_audit" }`.

## Migration

New table → the Medusa-generated `create table if not exists` migration is SAFE
here (the create-if-not-exists hazard only bites when you *edit* an existing
create migration to add a column — see
`reference_medusa_migration_create_if_not_exists_hazard`). Generate with
`npx medusa db:generate ops_audit`, then commit the generated migration. Verify
the file actually contains the CREATE before relying on it.

## Route changes

### `[id]/run/route.ts` — persist after running
After `const result = await job.run(...)`, keep the `logger.info`, then write the
row. **Never let an audit-write failure fail the job** (the correction already
happened) — wrap in try/catch and log on failure:

```typescript
const actorId = (req as any).auth_context?.actor_id ?? "unknown"
try {
  const audit: any = req.scope.resolve(OPS_AUDIT_MODULE)
  await audit.createOpsMaintenanceRuns({
    job_id: job.id,
    actor_id: actorId,
    dry_run: result.dry_run,
    applied: result.applied,
    change_count: result.changes.length,
    error_count: result.errors?.length ?? 0,
    summary: result.summary,
    params,
    changes: result.changes,
    errors: result.errors ?? [],
  })
} catch (e: any) {
  logger.error(`[ops/maintenance] audit persist failed: ${e?.message ?? e}`)
}
```
Response shape stays the same (keep the ephemeral `audit` object for callers
that read it inline).

### new `GET .../maintenance-jobs/runs/route.ts` — history
Mirror admin list-route pattern (read
`node_modules/@medusajs/medusa/dist/api/admin/...` for the exact
limit/offset/count envelope — don't invent). Use the module service's
`listAndCountOpsMaintenanceRuns` with `{ skip, take, order: { created_at: "DESC" } }`
and optional `job_id` / `dry_run` / `applied` filters. Place it at `runs/route.ts`
(sibling of `[id]/`) so it doesn't collide with the `:id/run` matcher.
Add a query validator (`limit`/`offset`/`job_id`/`dry_run`/`applied`) and wire it
via `validateAndTransformQuery` in the ops middleware.

## Tests

- **Unit** (preferred — pure, no DB): a small mapper
  `buildAuditRow(result, actorId, params)` extracted from the route, asserting
  the row shape for dry-run, apply-with-changes, no-op apply, and bulk-with-errors.
  Mirrors the existing `registry.unit.spec.ts` style.
- **Integration** (one file, `pnpm test:integration:http:shared <path>`): run a
  job dry-run → assert one row persisted with `dry_run=true, applied=false`; then
  `GET .../runs` returns it. Use the existing `recalculate-design-cost` job.
  ⚠ Per-file only (TRUNCATE-vs-CONCURRENTLY boot deadlock on whole-dir runs).

## Watch-outs

- **Stacking:** rebase onto `main` only after #470/#471 land; building off current
  `main` gives you no `:id/run` route to wire into.
- Register the module in **both** medusa-config files or prod boot won't see it.
- Audit write must be best-effort (try/catch) — a correction must not roll back
  because logging failed.
- `error_count`/`errors` are absent on single-entity jobs (they throw instead) —
  default to `0`/`[]`.
- tsc: annotate `const audit: any = req.scope.resolve(...)` to avoid the CI
  TS18046 "is of type unknown" build failure (see
  `reference_ci_build_unknown_container_resolve`).
