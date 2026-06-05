/**
 * @file Partner design cost re-estimation
 * @description Roadmap #6 Phase 3 — a partner triggers a cost estimate
 * for their OWN design (material + production cost from the linked
 * inventory BOM + order history). Mirrors
 * `POST /admin/designs/:id/recalculate-cost`; persists the richer cost
 * fields back onto the design so `GET .../cost` can read them.
 * @module API/Partners/Designs/RecalculateCost
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { estimateDesignCostWorkflow } from "../../../../../workflows/designs/estimate-design-cost"
import { DESIGN_MODULE } from "../../../../../modules/designs"
import { assertPartnerOwnsDesign } from "../../helpers"

export async function POST(
  req: AuthenticatedMedusaRequest & { params: { designId: string } },
  res: MedusaResponse
) {
  const { designId } = req.params
  await assertPartnerOwnsDesign(req, designId)

  const { result, errors } = await estimateDesignCostWorkflow(req.scope).run({
    input: { design_id: designId },
  })
  if (errors && errors.length > 0) {
    return res
      .status(400)
      .json({ error: "Failed to estimate cost", details: errors })
  }

  // Persist the estimate so the design carries its latest cost. Mirrors
  // the admin route but stores the fuller breakdown too.
  try {
    const designService = req.scope.resolve(DESIGN_MODULE) as any
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
        source: "partner_recalculate",
      },
    })
  } catch {
    // Non-fatal — the estimate was still computed + returned.
  }

  res.status(200).json({
    cost_estimate: result,
    message: `Cost recalculated: ${result.total_estimated} (${result.confidence})`,
  })
}
