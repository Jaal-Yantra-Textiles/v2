import type { MaintenanceJobResult } from "./registry"

/**
 * Shape of a row persisted to the `ops_maintenance_run` model (#457). Mirrors
 * the model's columns one-to-one (minus the auto id/timestamps).
 */
export type OpsMaintenanceRunRow = {
  job_id: string
  actor_id: string
  dry_run: boolean
  applied: boolean
  change_count: number
  error_count: number
  summary: string
  params: Record<string, unknown>
  changes: MaintenanceJobResult["changes"]
  errors: NonNullable<MaintenanceJobResult["errors"]>
}

/**
 * Pure mapper: maintenance-job result + actor + params → persistable audit row.
 * Extracted from the run route so the row shape is unit-testable without
 * booting the DB. `error_count`/`errors` default to 0/[] for single-entity jobs
 * (which omit `errors` and throw instead). #457.
 */
export function buildAuditRow(
  result: MaintenanceJobResult,
  actorId: string,
  params: Record<string, unknown>
): OpsMaintenanceRunRow {
  const errors = result.errors ?? []
  return {
    job_id: result.job_id,
    actor_id: actorId,
    dry_run: result.dry_run,
    applied: result.applied,
    change_count: result.changes.length,
    error_count: errors.length,
    summary: result.summary,
    params,
    changes: result.changes,
    errors,
  }
}
