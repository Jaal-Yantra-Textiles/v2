import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import partnerProductLink from "../../../../../../links/partner-product"
import { decideApprovalTransition } from "../../lib/artisan-approval"

const LINK_ENTRY = partnerProductLink.entryPoint

/**
 * Read the artisan-proposal state of a product for the admin approval widget
 * (#859 S2 / #861).
 *
 * @route GET /admin/partners/products/:id/proposal
 *
 * A product is an artisan proposal when it carries a `partner-product` link;
 * its lifecycle rides the native product `status` (`proposed` → `published` on
 * approve, `proposed` → `rejected` on reject). `can_approve`/`can_reject` are
 * derived from the SAME pure `decideApprovalTransition` the POST routes use, so
 * the widget can't offer an action the endpoint would refuse.
 */
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const productId = req.params.id
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any

  const { data: ownerLinks = [] } = await query.graph({
    entity: LINK_ENTRY,
    fields: ["partner_id", "product_id"],
    filters: { product_id: productId },
  })
  const hasOwnerLink = ownerLinks.length > 0
  const partnerId = ownerLinks[0]?.partner_id ?? null

  const { data: products = [] } = await query.graph({
    entity: "product",
    fields: ["id", "status"],
    filters: { id: productId },
  })
  const product = products[0]
  if (!product) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Product ${productId} not found`)
  }

  const facts = { hasOwnerLink, currentStatus: product.status }

  return res.json({
    is_artisan: hasOwnerLink,
    status: product.status,
    partner_id: partnerId,
    can_approve: decideApprovalTransition("approve", facts).ok,
    can_reject: decideApprovalTransition("reject", facts).ok,
  })
}
