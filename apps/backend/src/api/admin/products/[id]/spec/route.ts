import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { upsertProductSpecWorkflow } from "../../../../../workflows/products/upsert-product-spec"
import { PRODUCT_SPEC_MODULE } from "../../../../../modules/product-spec"
import type { PartnerProductSpecReqType } from "../../../../partners/products/validators"

/**
 * The admin mirror of the partner production-spec routes (#1342 / #1346).
 *
 * Same module, same workflow, same validator — an admin simply is not scoped to
 * one partner's products, so `assertProductOwnership` is replaced by an
 * existence check. That check is not ceremony: the partner route's ownership
 * lookup is what turns a mistyped product id into a 404 there, and without it
 * an admin (or the admin assistant) could otherwise write a spec row keyed to a
 * product that does not exist and never see it again.
 */
const assertProductExists = async (req: MedusaRequest, productId: string) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any
  const { data } = await query.graph({
    entity: "product",
    fields: ["id"],
    filters: { id: productId },
  })
  if (!data?.length) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Product ${productId} was not found`
    )
  }
}

/**
 * Read a product's production spec. `null` when none has been written — the
 * normal state for most products, not an error.
 *
 * @route GET /admin/products/:id/spec
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const productId = req.params.id
  await assertProductExists(req, productId)

  const service: any = req.scope.resolve(PRODUCT_SPEC_MODULE)
  const spec = await service.findByProduct(productId)

  return res.json({ spec })
}

/**
 * Create or update a product's production spec — weave, parameters, colour
 * palette and custom fields.
 *
 * `colors` and `fields` replace what is stored when present; omitting them
 * leaves the existing entries alone.
 *
 * @route POST /admin/products/:id/spec
 */
export const POST = async (
  req: MedusaRequest<PartnerProductSpecReqType>,
  res: MedusaResponse
) => {
  const productId = req.params.id
  await assertProductExists(req, productId)

  const { result } = await upsertProductSpecWorkflow(req.scope).run({
    input: { product_id: productId, data: req.validatedBody },
  })

  return res.json({ spec: result })
}
