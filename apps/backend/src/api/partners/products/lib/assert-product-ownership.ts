import { AuthenticatedMedusaRequest } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { tryGetPartnerSalesChannelId } from "../../helpers"
import partnerProductLink from "../../../../links/partner-product"

const LINK_ENTRY = partnerProductLink.entryPoint

/**
 * Assert the authenticated partner owns the product, returning the partner.
 *
 * Ownership is primarily the product being in the partner's store sales
 * channel — every partner product (dedicated or core-channel listing) is bound
 * to `store.default_sales_channel_id` on create. We also accept the
 * product → owning-partner link (recorded for artisan proposals) as a fallback.
 * Non-owners get a 404 (hide existence), mirroring the resubmit route.
 *
 * Extracted from the artisan-detail route (#859 S3) when the product-spec
 * routes (#1342) needed the same check: an ownership rule that exists in two
 * copies is one edit away from disagreeing with itself, and the copy that
 * drifts is the one that lets a partner read someone else's product.
 */
export const assertProductOwnership = async (
  req: AuthenticatedMedusaRequest,
  productId: string
) => {
  if (!req.auth_context?.actor_id) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "Partner authentication required"
    )
  }
  const { partner, salesChannelId } = await tryGetPartnerSalesChannelId(
    req.auth_context,
    req.scope
  )
  if (!partner) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "No partner associated with this account"
    )
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any

  const { data: products = [] } = await query.graph({
    entity: "product",
    fields: ["id", "sales_channels.id"],
    filters: { id: productId },
  })
  const product = products[0]

  const inPartnerChannel =
    !!salesChannelId &&
    ((product?.sales_channels as any[]) || []).some(
      (sc: any) => sc?.id === salesChannelId
    )

  let ownedViaLink = false
  if (product && !inPartnerChannel) {
    const { data: ownerLinks = [] } = await query.graph({
      entity: LINK_ENTRY,
      fields: ["partner_id", "product_id"],
      filters: { product_id: productId },
    })
    ownedViaLink = ownerLinks.some((l: any) => l.partner_id === partner.id)
  }

  if (!product || (!inPartnerChannel && !ownedViaLink)) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Product ${productId} not found`
    )
  }
  return partner
}
