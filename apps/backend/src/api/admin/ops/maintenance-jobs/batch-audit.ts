import type { MaintenanceJobResult } from "./registry"

/**
 * Normalized outcome of one child job within a batch run (Data Plumbing v2,
 * #508). A child either succeeds with a `MaintenanceJobResult` (`ok: true`) or
 * throws a caught error (`ok: false`) — the batch executor catches per-job
 * `MedusaError`s so one bad job never aborts the whole request.
 */
export type BatchChildOutcome = {
  job_id: string
  ok: boolean
  /** Present when `ok` — the job's own result. */
  result?: MaintenanceJobResult
  /** Present when `!ok` — the caught error message. */
  error?: string
}

/**
 * Shape persisted to the `ops_maintenance_batch` parent model (#508). Mirrors
 * the model columns one-to-one (minus auto id/timestamps). The parent stores
 * its own rollup so the history list never re-aggregates the child runs.
 */
export type OpsMaintenanceBatchRow = {
  name: string
  actor_id: string
  dry_run: boolean
  stop_on_error: boolean
  job_count: number
  applied_count: number
  failed_count: number
  change_count: number
  error_count: number
  summary: string
}

/**
 * Pure rollup builder: child outcomes + batch metadata → persistable parent
 * batch row. Extracted so the rollup is unit-testable without booting the DB,
 * and reused by the batch run endpoint (slice 2). Counts:
 *
 * - `job_count`    — child jobs attempted (successes + failures)
 * - `applied_count`— children that actually wrote (`ok && result.applied`)
 * - `failed_count` — children that threw (`!ok`)
 * - `change_count` — total `changes` rows across successful children
 * - `error_count`  — total per-entity `errors` across successful children
 *                    (NOT the failed-job count — that's `failed_count`)
 */
export function buildBatchRollup(
  outcomes: BatchChildOutcome[],
  meta: {
    name: string
    actorId: string
    dryRun: boolean
    stopOnError: boolean
  }
): OpsMaintenanceBatchRow {
  const successes = outcomes.filter((o) => o.ok && o.result)

  const applied_count = successes.filter((o) => o.result!.applied).length
  const failed_count = outcomes.filter((o) => !o.ok).length
  const change_count = successes.reduce(
    (sum, o) => sum + o.result!.changes.length,
    0
  )
  const error_count = successes.reduce(
    (sum, o) => sum + (o.result!.errors?.length ?? 0),
    0
  )

  const verb = meta.dryRun ? "Previewed" : "Applied"
  const summary =
    `${verb} ${outcomes.length} job(s): ${change_count} change(s), ` +
    `${applied_count} applied, ${failed_count} failed, ${error_count} error(s)`

  return {
    name: meta.name,
    actor_id: meta.actorId,
    dry_run: meta.dryRun,
    stop_on_error: meta.stopOnError,
    job_count: outcomes.length,
    applied_count,
    failed_count,
    change_count,
    error_count,
    summary,
  }
}
