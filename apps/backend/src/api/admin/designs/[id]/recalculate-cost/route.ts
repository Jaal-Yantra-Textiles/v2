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

  // Update design with the new estimate
  try {
    const designService = req.scope.resolve("design") as any
    await designService.updateDesigns({
      id: designId,
      estimated_cost: result.total_estimated,
    })
  } catch {
    // Non-fatal — estimate was still calculated
  }

  res.status(200).json({
    cost_estimate: result,
    message: `Cost recalculated: ${result.total_estimated} (${result.confidence})`,
  })
}
