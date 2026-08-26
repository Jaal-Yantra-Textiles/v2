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
  /**
   * null when the estimator had nothing to price from. Shown as a gap the admin
   * must fill, never as a zero — this preview is what someone reads before
   * deciding to bill a customer. #1564
   */
  total_estimated: number | null
  unit_price: number | null
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

  /**
   * The total covers only what could actually be priced.
   *
   * ⚠️ Summing an unpriceable design as 0 would quietly understate the order —
   * the admin sees a total that looks complete and is not. `unpriceable` names
   * exactly what is missing from it, so the gap is visible rather than absorbed.
   */
  const unpriceable = estimates
    .filter((e) => e.unit_price == null)
    .map((e) => ({ design_id: e.design_id, name: e.name }))

  const total = estimates.reduce((sum, e) => sum + (e.unit_price ?? 0), 0)

  res.json({
    estimates,
    currency_code: currency_code || "inr",
    total,
    unpriceable,
    /** False when any line has no price — the total is partial. */
    total_is_complete: unpriceable.length === 0,
  })
}
