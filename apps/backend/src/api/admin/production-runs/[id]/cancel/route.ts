import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { PRODUCTION_RUNS_MODULE } from "../../../../../modules/production_runs"
import type ProductionRunService from "../../../../../modules/production_runs/service"
import { cancelProductionRunCascade } from "../../../../../workflows/production-runs/lib/cancel-production-run-cascade"

/**
 * POST /admin/production-runs/:id/cancel
 *
 * Cancels a production run and its associated tasks.
 * - Sets run status to "cancelled"
 * - Cancels all linked tasks for the run and its children
 * - Also cancels child runs if this is a parent run
 * - If cancelling a child run, checks if all siblings are now terminal
 *   and cancels the parent if so
 * - Mirrors onto the unified order (partner_status `cancelled` since #1574, so
 *   the order stops rendering as live work) and emits
 *   `production_run.cancelled`, which is what emails the partner and writes the
 *   admin feed entry
 *
 * 🔑 The behaviour lives in `cancelProductionRunCascade`, shared with the #1574
 * inactivity sweep. Six ordered side effects are too many to keep in step
 * across two copies — and the drift would surface as a partner never being told
 * their work was called off.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params
  const productionRunService: ProductionRunService = req.scope.resolve(
    PRODUCTION_RUNS_MODULE
  )
  const reason = (req.body as any)?.reason || "Admin cancelled"

  let run: any
  try {
    run = await productionRunService.retrieveProductionRun(id)
  } catch {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Production run not found"
    )
  }

  if (run.status === "cancelled") {
    return res.json({ production_run: run, message: "Already cancelled" })
  }

  if (run.status === "completed") {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Cannot cancel a completed production run"
    )
  }

  const { run: final, cancelled_children } = await cancelProductionRunCascade(
    req.scope,
    id,
    reason
  )

  res.json({
    production_run: final,
    cancelled_children,
    message: `Production run cancelled${cancelled_children.length ? `. ${cancelled_children.length} child run(s) also cancelled.` : "."}`,
  })
}
