import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { assertProductOwnership } from "../../lib/assert-product-ownership"
import { upsertProductSpecWorkflow } from "../../../../../workflows/products/upsert-product-spec"
import { PRODUCT_SPEC_MODULE } from "../../../../../modules/product-spec"
import type { PartnerProductSpecReqType } from "../../validators"

/**
 * Read the production spec for one of the partner's own products (#1342).
 *
 * Returns `null` when the partner has not written one — an absent spec is the
 * normal state for most products, not an error.
 *
 * @route GET /partners/products/:id/spec
 */
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const productId = req.params.id
  await assertProductOwnership(req, productId)

  const service: any = req.scope.resolve(PRODUCT_SPEC_MODULE)
  const spec = await service.findByProduct(productId)

  return res.json({ spec })
}

/**
 * Create or update the production spec — weave, parameters, colour palette and
 * partner-defined fields — for one of the partner's own products (#1342).
 *
 * `colors` and `fields` replace what is stored when present; omitting them
 * leaves the existing entries alone.
 *
 * @route POST /partners/products/:id/spec
 */
export const POST = async (
  req: AuthenticatedMedusaRequest<PartnerProductSpecReqType>,
  res: MedusaResponse
) => {
  const productId = req.params.id
  await assertProductOwnership(req, productId)

  const { result } = await upsertProductSpecWorkflow(req.scope).run({
    input: { product_id: productId, data: req.validatedBody },
  })

  return res.json({ spec: result })
}
