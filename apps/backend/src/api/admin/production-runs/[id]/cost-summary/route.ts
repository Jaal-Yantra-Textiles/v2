/**
 * @file Admin production-run cost summary
 * @description Delegates to the shared `computeRunCostSummary` (#2028 item 2).
 *
 * 🔴 This handler used to reimplement the rollup — 261 lines of material /
 * energy / labour totals, rate-map resolution and line totals, carrying the
 * comment "Kept byte-identical to `computeRunCostSummary`'s `currency`".
 * Byte-identical is a claim about the PAST: the shared module was extracted
 * FROM this route, and the copy had already drifted once (the `currency`
 * field landed on the partner side first and an integration test caught it
 * missing here). A second implementation of a money rollup means any future
 * fix to the shared module silently never reaches admin.
 *
 * @module API/Admin/ProductionRuns/CostSummary
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { computeRunCostSummary } from "../../../../../modules/production_runs/cost-summary"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const runId = req.params.id

  // Throws MedusaError NOT_FOUND (`Production run <id> not found`) when the
  // run does not exist — the same error this route raised inline.
  const cost_summary = await computeRunCostSummary(req.scope, runId)

  res.status(200).json({ cost_summary })
}
