import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import type { RelinkDesignProduct } from "../../../validators"
import {
  loadRelinkPlan,
  relinkDesignProductWorkflow,
} from "../../../../../../workflows/designs/relink-design-product"

/**
 * POST /admin/designs/:id/products/relink — point a design at an EXISTING
 * product (#2477 part 2).
 *
 * Approval reuses whatever product a design links to, so a design minted onto
 * the wrong product is approved onto it again and again. This moves the
 * product link, the design's variant links and the design's runs together —
 * see `lib/relink-design-product-plan.ts` for why all three.
 *
 * It never deletes the old product and never touches prices or stock: the old
 * product is left unlinked for a human to delete, and stock already counted
 * stays where it was counted.
 *
 * `preview: true` returns the plan and writes nothing.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest<RelinkDesignProduct>,
  res: MedusaResponse
): Promise<void> => {
  const body = req.validatedBody
  const plan = await loadRelinkPlan(req.scope, {
    design_id: req.params.id,
    product_id: body.product_id,
    variant_ids: body.variant_ids ?? null,
    move_variants_from_other_designs: body.move_variants_from_other_designs === true,
  })

  if (body.preview === true || plan.noop) {
    res.status(200).json({ applied: false, preview: body.preview === true, plan })
    return
  }

  const { result } = await relinkDesignProductWorkflow(req.scope).run({
    input: plan,
  })
  res.status(200).json({ applied: true, plan: result })
}
