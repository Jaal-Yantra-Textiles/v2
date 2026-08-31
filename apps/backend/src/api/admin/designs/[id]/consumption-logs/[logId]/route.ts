/**
 * Correct or retire one consumption log.
 *
 *   PATCH  /admin/designs/:id/consumption-logs/:logId
 *   DELETE /admin/designs/:id/consumption-logs/:logId
 *
 * ## Why this exists
 *
 * There was no way to fix a consumption log. `/admin/designs/:id/
 * consumption-logs` is POST and GET; the run-level route is the same;
 * `updateConsumptionLogs` was reachable only from the commit flow and two ops
 * jobs. So a wrong material quantity — the figure that decides stock deduction
 * AND design cost — could be recorded and then only ever added to.
 *
 * Found on a real design: three logs, one of them a duplicate of another, and
 * two carrying a `per_piece` basis that could not express what happened. One
 * garment was cut from muslin (2 m) and two from kala cotton (2 m each) — 6 m
 * over 3 pieces. `per_piece × pieces` applies ONE piece count to EVERY
 * material, so those logs would have deducted 2×3 and 2×3 = 12 m: exactly
 * double, silently, the first time anyone applied them.
 *
 * ## 🔴 What it refuses
 *
 * A log whose stock movement has already happened (`inventory_applied_at`
 * set) is NOT editable. At that point the number is not a claim about the
 * world, it is a description of a decrement that occurred — editing it would
 * leave the log and the stock level disagreeing with nothing to reconcile
 * them. That needs a reversing entry, which is a different operation and a
 * deliberate one.
 *
 * Every write lands an `ops_maintenance_run` audit row carrying the BEFORE and
 * AFTER, so a corrected number can always be traced to who changed it and from
 * what. Best-effort, exactly as the maintenance-job route treats it: the
 * correction already happened, so an audit failure must not fail the request.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"

import { CONSUMPTION_LOG_MODULE } from "../../../../../../modules/consumption_log"
import { OPS_AUDIT_MODULE } from "../../../../../../modules/ops_audit"

/** The fields a correction may touch. Everything else identifies the log. */
const EDITABLE = ["quantity", "quantity_basis", "unit_cost", "notes", "location_id"] as const

const loadOwnedLog = async (
  req: MedusaRequest,
  designId: string,
  logId: string
) => {
  const service: any = req.scope.resolve(CONSUMPTION_LOG_MODULE)
  const log = await service.retrieveConsumptionLog(logId).catch(() => null)

  // 🔴 Ownership, not just existence — the design id in the path must be the
  // one the log belongs to, or a log could be edited through any design's URL.
  if (!log || log.design_id !== designId) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Consumption log not found")
  }
  return { service, log }
}

const assertNotApplied = (log: any) => {
  const applied = log.inventory_applied_at ?? log.metadata?.inventory_applied_at
  if (applied) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "This log's stock movement has already been applied — correct it with a reversing entry, not an edit."
    )
  }
}

const audit = async (
  req: MedusaRequest,
  input: { action: string; before: any; after: any; summary: string }
) => {
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const actorId = (req as any).auth_context?.actor_id ?? "unknown"

  logger.info(
    `[consumption-log] actor=${actorId} ${input.action} log=${input.before?.id} ${input.summary}`
  )

  try {
    const store: any = req.scope.resolve(OPS_AUDIT_MODULE)
    await store.createOpsMaintenanceRuns({
      job_id: `admin.${input.action}`,
      actor_id: actorId,
      dry_run: false,
      applied: true,
      change_count: 1,
      error_count: 0,
      summary: input.summary,
      params: { consumption_log_id: input.before?.id, design_id: input.before?.design_id },
      changes: [{ before: input.before, after: input.after }],
      errors: [],
    })
  } catch (e: any) {
    // The correction already happened; losing the audit row must not fail it.
    logger.error(`[consumption-log] audit persist failed: ${e?.message ?? e}`)
  }
}

export const PATCH = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id: designId, logId } = req.params
  const { service, log } = await loadOwnedLog(req, designId, logId)
  assertNotApplied(log)

  const body = (req.validatedBody ?? req.body ?? {}) as Record<string, any>
  const update: Record<string, any> = {}
  for (const field of EDITABLE) {
    if (body[field] !== undefined) update[field] = body[field]
  }

  if (!Object.keys(update).length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Nothing to change — pass one of: ${EDITABLE.join(", ")}.`
    )
  }

  /**
   * ⚠️ `quantity_basis` is the field this route mostly exists for, and it is
   * the one that changes MEANING rather than magnitude: the same `quantity`
   * deducts `q` under "total" and `q × pieces` under "per_piece". A correction
   * that sets it is not a tidy-up.
   */
  await service.updateConsumptionLogs({ id: logId, ...update })
  const after = await service.retrieveConsumptionLog(logId)

  await audit(req, {
    action: "consumption-log.edit",
    before: log,
    after,
    summary: Object.keys(update)
      .map((k) => `${k}: ${JSON.stringify((log as any)[k])} → ${JSON.stringify(update[k])}`)
      .join("; "),
  })

  res.json({ consumption_log: after })
}

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id: designId, logId } = req.params
  const { service, log } = await loadOwnedLog(req, designId, logId)
  assertNotApplied(log)

  await service.deleteConsumptionLogs(logId)

  await audit(req, {
    action: "consumption-log.delete",
    before: log,
    after: null,
    summary: `retired ${log.quantity} ${log.unit_of_measure} of ${log.inventory_item_id ?? log.consumption_type}`,
  })

  res.status(200).json({ id: logId, object: "consumption_log", deleted: true })
}
