import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { estimateDesignCostWorkflow } from "../../../../../workflows/designs/estimate-design-cost"

/**
 * POST /admin/designs/:id/recalculate-cost
 *
 * Triggers cost re-estimation for a design using the estimateDesignCostWorkflow.
 * If a sample run has completed and stored cost_breakdown, the workflow will
 * use that data. Otherwise, it estimates from inventory order history.
 */
export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const designId = req.params.id

  const { result, errors } = await estimateDesignCostWorkflow(req.scope).run({
    input: { design_id: designId },
  })

  if (errors && errors.length > 0) {
    return res.status(400).json({ error: "Failed to estimate cost", details: errors })
  }

  // Persist the full estimate back onto the design so readers of the stored
  // cost fields (design cost panels, partner `GET .../cost`) surface the
  // material + production breakdown — not just the total. Mirrors the partner
  // recalculate route, which already persisted all of these. Previously this
  // route stored only `estimated_cost`, so `material_cost`/`production_cost`/
  // `cost_breakdown` stayed null on admin-owned designs and material cost
  // never showed even when the linked BOM had a price. #456
  /**
   * 🔴 A recalculation that found nothing must not overwrite what is there.
   *
   * The estimator used to report "no BOM, no order history" as
   * `total_estimated: 0`, and this route persisted it — turning designs whose
   * cost was honestly UNKNOWN (null) into designs that state they are free.
   * Running the recalculation was itself the damaging act: five designs on
   * production now carry a stored 0 that nobody ever asserted.
   *
   * So a `none` result writes nothing at all. Not even the breakdown: an
   * "I looked and found nothing" record would still leave `estimated_cost`
   * unchanged while implying the figure beside it had been refreshed. #1564
   */
  const foundNothing = result.total_estimated == null

  if (!foundNothing) {
    try {
      const designService = req.scope.resolve("design") as any
      await designService.updateDesigns({
        id: designId,
        estimated_cost: result.total_estimated,
        material_cost: result.material_cost,
        production_cost: result.production_cost,
        cost_breakdown: {
          items: result.breakdown?.materials ?? [],
          production_percent: result.breakdown?.production_percent,
          confidence: result.confidence,
          calculated_at: new Date().toISOString(),
          source: "admin_recalculate",
        },
      })
    } catch {
      // Non-fatal — estimate was still calculated
    }
  }

  res.status(200).json({
    cost_estimate: result,
    /** Stated explicitly so a caller cannot read a 200 as "the design was updated". */
    persisted: !foundNothing,
    message: foundNothing
      ? "No cost could be estimated — this design has no bill of materials and no cost history. The stored cost was left unchanged."
      : `Cost recalculated: ${result.total_estimated} (${result.confidence})`,
  })
}
