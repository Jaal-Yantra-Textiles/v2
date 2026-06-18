import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

import { getMaintenanceJob } from "../../registry"
import { OpsMaintenanceRunBody } from "../../validators"
import { buildAuditRow } from "../../audit"
import { OPS_AUDIT_MODULE } from "../../../../../../modules/ops_audit"

/**
 * POST /admin/ops/maintenance-jobs/:id/run
 *
 * Runs a guarded maintenance job. Safe by default: dry_run defaults to true, so
 * a body of {} previews changes without writing. Pass { dry_run: false } to
 * apply. Every run is logged with the actor + outcome AND persisted to the
 * durable `ops_maintenance_run` audit log (best-effort — a correction never
 * rolls back because logging failed). (#457)
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const job = getMaintenanceJob(req.params.id)
  if (!job) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Unknown maintenance job: ${req.params.id}`
    )
  }

  const body = (req.validatedBody ?? {}) as OpsMaintenanceRunBody
  const dry_run = body.dry_run ?? true
  const params = (body.params ?? {}) as Record<string, unknown>

  const result = await job.run(req.scope, { dry_run, params })

  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const actorId = (req as any).auth_context?.actor_id ?? "unknown"
  logger.info(
    `[ops/maintenance] actor=${actorId} job=${job.id} dry_run=${result.dry_run} applied=${result.applied} changes=${result.changes.length}`
  )

  // Durable audit row — best-effort: the correction already happened, so an
  // audit-write failure must NOT fail the request. (#457)
  const row = buildAuditRow(result, actorId, params)
  try {
    const audit: any = req.scope.resolve(OPS_AUDIT_MODULE)
    await audit.createOpsMaintenanceRuns(row)
  } catch (e: any) {
    logger.error(`[ops/maintenance] audit persist failed: ${e?.message ?? e}`)
  }

  res.json({
    result,
    audit: {
      actor_id: actorId,
      job_id: job.id,
      dry_run: result.dry_run,
      applied: result.applied,
      change_count: result.changes.length,
      ran_at: new Date().toISOString(),
    },
  })
}
