import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

import { getMaintenanceJob } from "../registry"
import { OpsMaintenanceBatchBody } from "../validators"
import { runBatch } from "../batch-executor"
import type { BatchJobSpec } from "../batch-executor"
import { buildBatchRollup, buildBatchChildRow } from "../batch-audit"
import { OPS_AUDIT_MODULE } from "../../../../../modules/ops_audit"

/**
 * POST /admin/ops/maintenance-jobs/batches
 *
 * Run several guarded maintenance jobs as ONE sequential batch (Data Plumbing
 * v2, #508). Stateless "A2": this single call runs + records the whole batch —
 * Preview and Apply are two calls with `dry_run` flipped. Safe by default:
 * `dry_run` defaults to true, so a body with only `jobs` previews without
 * writing.
 *
 * Contract:
 *   - Jobs run sequentially under one batch-level `dry_run`.
 *   - A child job that throws is CAUGHT and recorded as a failed child — it does
 *     NOT abort the request (unlike the single-job `:id/run` route). Pass
 *     `stop_on_error=true` to halt after the first failure.
 *   - Persists one `ops_maintenance_batch` parent (rollup) + one
 *     `ops_maintenance_run` child per attempted job (best-effort: the
 *     corrections already ran, so an audit-write failure never fails the
 *     request).
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const body = (req.validatedBody ?? {}) as OpsMaintenanceBatchBody

  const jobs: BatchJobSpec[] = body.jobs.map((j) => ({
    job_id: j.job_id,
    params: (j.params ?? {}) as Record<string, unknown>,
  }))
  const dry_run = body.dry_run ?? true
  const stop_on_error = body.stop_on_error ?? false
  const name = body.name?.trim() || `Batch of ${jobs.length} job(s)`

  // Validate every job id against the registry UP FRONT → 400. A single unknown
  // id fails the whole batch before any job runs (an unknown id is a caller
  // mistake, distinct from a job that runs and then throws).
  const unknown = [
    ...new Set(jobs.filter((j) => !getMaintenanceJob(j.job_id)).map((j) => j.job_id)),
  ]
  if (unknown.length > 0) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Unknown maintenance job(s): ${unknown.join(", ")}`
    )
  }

  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const actorId = (req as any).auth_context?.actor_id ?? "unknown"

  // Sequential run — per-job errors are caught inside runBatch.
  const outcomes = await runBatch(req.scope, { jobs, dry_run, stop_on_error })

  const rollup = buildBatchRollup(outcomes, {
    name,
    actorId,
    dryRun: dry_run,
    stopOnError: stop_on_error,
  })

  logger.info(
    `[ops/maintenance] batch actor=${actorId} name="${name}" dry_run=${dry_run} jobs=${rollup.job_count} applied=${rollup.applied_count} failed=${rollup.failed_count} changes=${rollup.change_count}`
  )

  // Durable audit — best-effort: the corrections already happened, so an
  // audit-write failure must NOT fail the request. (#508, mirrors #457)
  let batchId: string | null = null
  try {
    const audit: any = req.scope.resolve(OPS_AUDIT_MODULE)
    const batch = await audit.createOpsMaintenanceBatches(rollup)
    batchId = batch.id

    const childRows = outcomes.map((outcome, i) =>
      buildBatchChildRow(outcome, {
        actorId,
        params: jobs[i].params,
        dryRun: dry_run,
        batchId: batch.id,
        jobIndex: i,
      })
    )
    if (childRows.length > 0) {
      await audit.createOpsMaintenanceRuns(childRows)
    }
  } catch (e: any) {
    logger.error(`[ops/maintenance] batch audit persist failed: ${e?.message ?? e}`)
  }

  res.json({
    batch: {
      id: batchId,
      ...rollup,
      ran_at: new Date().toISOString(),
    },
    results: outcomes.map((o, i) => ({
      job_id: o.job_id,
      job_index: i,
      ok: o.ok,
      result: o.result,
      error: o.error,
    })),
  })
}
