import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

import { getMaintenanceJob } from "../../registry"
import { OpsMaintenanceRunBody } from "../../validators"

/**
 * POST /admin/ops/maintenance-jobs/:id/run
 *
 * Runs a guarded maintenance job. Safe by default: dry_run defaults to true, so
 * a body of {} previews changes without writing. Pass { dry_run: false } to
 * apply. Every run is logged with the actor + outcome (lightweight audit;
 * a durable audit-log model is a follow-up slice). (#457)
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
