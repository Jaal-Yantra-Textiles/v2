import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import { updateProductsWorkflow } from "@medusajs/medusa/core-flows"
import { getPartnerFromAuthContext } from "../../../helpers"
import partnerProductLink from "../../../../../links/partner-product"
import { decideResubmit } from "../../lib/artisan-resubmit"

const LINK_ENTRY = partnerProductLink.entryPoint

/**
 * Re-submit a rejected artisan product for review (#859 S2 / #861).
 *
 * @route POST /partners/products/:id/resubmit
 *
 * The counterpart to the admin reject: after an admin rejects a proposal
 * (status `rejected`, with a reason surfaced to the artisan), the owning
 * partner revises and re-submits — flipping `rejected` → `proposed` and
 * re-emitting `partner_product.proposed` so the product re-enters the admin
 * review queue (and any visual-flow automations). The stale rejection reason is
 * cleared. Only the owning partner, and only from `rejected`, may do this.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  if (!req.auth_context?.actor_id) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Partner authentication required")
  }
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "No partner associated with this admin")
  }

  const productId = req.params.id
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any

  const { data: ownerLinks = [] } = await query.graph({
    entity: LINK_ENTRY,
    fields: ["partner_id", "product_id"],
    filters: { product_id: productId },
  })
  const ownedByPartner = ownerLinks.some(
    (l: any) => l.partner_id === partner.id
  )

  const { data: products = [] } = await query.graph({
    entity: "product",
    fields: ["id", "status"],
    filters: { id: productId },
  })
  const product = products[0]
  if (!product) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Product ${productId} not found`)
  }

  const decision = decideResubmit({
    ownedByPartner,
    currentStatus: product.status,
  })
  if (!decision.ok) {
    throw new MedusaError(
      decision.code === "not_owner"
        ? MedusaError.Types.NOT_FOUND
        : MedusaError.Types.INVALID_DATA,
      decision.reason
    )
  }

  await updateProductsWorkflow(req.scope).run({
    input: { products: [{ id: productId, status: decision.nextStatus }] },
  })

  const eventBus = req.scope.resolve(Modules.EVENT_BUS) as any
  await eventBus
    .emit({
      name: decision.event,
      data: { id: productId, partner_id: partner.id, resubmitted: true },
    })
    .catch(() => {})

  return res.json({ id: productId, status: decision.nextStatus, partner_id: partner.id })
}
