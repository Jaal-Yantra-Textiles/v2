import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { estimateDesignCostWorkflow, type EstimateCostOutput } from "../../../../../../workflows/designs/estimate-design-cost"

type PreviewDesignOrderBody = {
  design_ids: string[]
  currency_code?: string
}

type EstimatePreviewItem = {
  design_id: string
  name: string
  total_estimated: number
  unit_price: number
  confidence: string
  material_cost: number
  production_cost: number
}

export const POST = async (
  req: MedusaRequest<PreviewDesignOrderBody>,
  res: MedusaResponse
) => {
  const { design_ids, currency_code } = req.validatedBody as PreviewDesignOrderBody

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any

  const estimates: EstimatePreviewItem[] = []

  for (const design_id of design_ids) {
    const { data: designs } = await query.graph({
      entity: "design",
      filters: { id: design_id },
      fields: ["id", "name"],
    })

    const design = designs?.[0]
    if (!design) {
      res.status(404).json({ message: `Design not found: ${design_id}` })
      return
    }

    const { result: costEstimate } = await estimateDesignCostWorkflow(
      req.scope
    ).run({ input: { design_id } }) as { result: EstimateCostOutput }

    estimates.push({
      design_id,
      name: design.name,
      total_estimated: costEstimate.total_estimated,
      unit_price: costEstimate.total_estimated,
      confidence: costEstimate.confidence,
      material_cost: costEstimate.material_cost,
      production_cost: costEstimate.production_cost,
    })
  }

  const total = estimates.reduce((sum, e) => sum + e.unit_price, 0)

  res.json({
    estimates,
    currency_code: currency_code || "inr",
    total,
  })
}
