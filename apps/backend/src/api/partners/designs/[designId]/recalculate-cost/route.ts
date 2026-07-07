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
import { MedusaError } from "@medusajs/framework/utils"
import {
  estimateDesignCostWorkflow,
  DEFAULT_PLATFORM_FEE_PERCENT,
  DEFAULT_MATERIAL_COST,
} from "../../../../../workflows/designs/estimate-design-cost"
import { DESIGN_MODULE } from "../../../../../modules/designs"
import { assertPartnerOwnsDesign } from "../../helpers"

/**
 * Optional body: `{ production_cost?: number }` — the partner's own production
 * cost per finished unit. When supplied it overrides the derived estimate (the
 * 30%-of-material fallback), and a JYT platform fee (10% of material) is folded
 * into the total as a `platform_fee` line.
 */
export async function POST(
  req: AuthenticatedMedusaRequest & { params: { designId: string } },
  res: MedusaResponse
) {
  const { designId } = req.params
  await assertPartnerOwnsDesign(req, designId)

  // Partner-entered per-unit production cost (optional). Reject anything that
  // isn't a finite, non-negative number so a typo can't poison the estimate.
  const rawProductionCost = (req.body as any)?.production_cost
  let productionCostOverride: number | undefined
  if (rawProductionCost != null) {
    const parsed = Number(rawProductionCost)
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "production_cost must be a non-negative number"
      )
    }
    productionCostOverride = parsed
  }

  const { result, errors } = await estimateDesignCostWorkflow(req.scope).run({
    input: {
      design_id: designId,
      production_cost_override: productionCostOverride ?? null,
      platform_fee_percent: DEFAULT_PLATFORM_FEE_PERCENT,
      default_material_cost: DEFAULT_MATERIAL_COST,
    },
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
        platform_fee: result.platform_fee,
        platform_fee_percent: result.breakdown?.platform_fee_percent,
        production_cost_source:
          productionCostOverride != null ? "partner_entered" : "estimated",
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
