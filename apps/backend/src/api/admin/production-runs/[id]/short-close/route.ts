import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import {
  shortCloseProductionRun,
  reopenProductionRun,
} from "../../../../../workflows/production-runs/lib/short-close-production-run"

/**
 * POST   /admin/production-runs/:id/short-close   — close it
 * DELETE /admin/production-runs/:id/short-close   — reopen it
 *
 * #1596. A run ordered for 9 and completed at 7 keeps 2 units billable, because
 * the ceiling is the ORDERED quantity and that number cannot tell "not made
 * yet" from "never will be made". This says the latter, after which the run
 * bills to what it produced.
 *
 * 🔑 The behaviour lives in `short-close-production-run`, shared with the
 * 30-day counter. Two copies of a rule that decides how much a partner may
 * claim is how the screen and the sweep start disagreeing about someone's
 * money.
 *
 * Nothing is clawed back. A run legitimately billed to 7 and then closed at 4
 * keeps those 7; the remainder clamps at zero and the write guard refuses more.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params
  const reason =
    typeof (req.body as any)?.reason === "string" &&
    (req.body as any).reason.trim()
      ? (req.body as any).reason.trim()
      : null

  const actorId = (req as any).auth_context?.actor_id ?? "admin"

  let outcome
  try {
    outcome = await shortCloseProductionRun(req.scope, {
      run_id: id,
      actor_id: String(actorId),
      actor_type: "admin",
      reason,
    })
  } catch {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Production run not found")
  }

  if (!outcome.closed && outcome.reason === "no_output_figure") {
    // Refused rather than performed: with no produced figure the ceiling would
    // stay at the ordered quantity, so the close would look like a decision
    // while changing nothing.
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "This run has no recorded output, so closing it would not change what is billable. Record the produced quantity first."
    )
  }

  res.status(200).json({
    production_run: outcome.run,
    short_closed: outcome.closed,
    /** `already_closed` when a repeat call found nothing to do. */
    outcome: outcome.reason,
  })
}

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params
  const actorId = (req as any).auth_context?.actor_id ?? "admin"

  let outcome
  try {
    outcome = await reopenProductionRun(req.scope, {
      run_id: id,
      actor_id: String(actorId),
      actor_type: "admin",
      reason:
        typeof (req.body as any)?.reason === "string"
          ? (req.body as any).reason
          : null,
    })
  } catch {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Production run not found")
  }

  res.status(200).json({
    production_run: outcome.run,
    reopened: outcome.reopened,
  })
}
