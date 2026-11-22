import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { estimateDesignCostWorkflow, type EstimateCostOutput } from "../../../../../../workflows/designs/estimate-design-cost"

type PreviewDesignOrderBody = {
  design_ids: string[]
  currency_code?: string
  /** Agreed per-design unit prices, major units — what create will charge. */
  price_overrides?: Record<string, number>
  override_currency?: string
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
  const { design_ids, currency_code, price_overrides, override_currency } =
    req.validatedBody as PreviewDesignOrderBody
  /**
   * 🔴 The preview used to ignore `price_overrides`, which create applies. So
   * the one call meant to show the price BEFORE creating showed an estimate
   * (or "unpriceable") for a design the admin had already priced — seen on
   * 2026-11-22: a ₹1 override previewed as total 0, unpriceable. Same rule as
   * `create-draft-order-from-designs`: an override wins and skips the estimator.
   */
  const overrides = price_overrides || {}
  const orderCurrency = (currency_code || "inr").toLowerCase()
  const overrideCurrency = (override_currency || orderCurrency).toLowerCase()

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

    if (design_id in overrides) {
      const price = Number(overrides[design_id])
      estimates.push({
        design_id,
        name: design.name,
        total_estimated: price,
        unit_price: price,
        confidence: "manual",
        material_cost: 0,
        production_cost: 0,
      })
      continue
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
    /**
     * Set when an override is in a different currency from the order. Create
     * converts it; this preview does not, so its total mixes currencies and
     * says so rather than quietly adding rupees to euros.
     */
    currency_note:
      Object.keys(overrides).length && overrideCurrency !== orderCurrency
        ? `Overrides are in ${overrideCurrency.toUpperCase()} and the order is in ${orderCurrency.toUpperCase()}; create converts them, this preview does not.`
        : null,
  })
}
