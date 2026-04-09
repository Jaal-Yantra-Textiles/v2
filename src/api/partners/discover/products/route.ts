import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { getPartnerStore, tryGetPartnerStore } from "../../helpers"

/**
 * GET /partners/discover/products
 * Returns randomized products from OTHER partners' sales channels.
 * Excludes the current partner's own products.
 */
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { store } = await tryGetPartnerStore(req.auth_context, req.scope)
  if (!store) {
    return res.json({ products: [], count: 0, offset: 0, limit: 20 })
  }
  const mySalesChannelId = store.default_sales_channel_id

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const limit = Math.min(Number(req.query.limit) || 20, 50)
  const offset = Number(req.query.offset) || 0

  // Fetch all published products with their sales channels, images, variants, and prices
  const { data: allProducts } = await query.graph({
    entity: "product",
    fields: [
      "id",
      "title",
      "subtitle",
      "description",
      "handle",
      "thumbnail",
      "status",
      "images.*",
      "variants.id",
      "variants.title",
      "variants.sku",
      "variants.prices.*",
      "options.*",
      "type.*",
      "collection.*",
      "tags.*",
      "categories.*",
      "sales_channels.id",
      "sales_channels.name",
    ],
    filters: {
      status: "published",
    },
  }, { locale: req.locale })

  // Filter out products that belong to this partner's sales channel
  const discoverable = (allProducts || []).filter((p: any) => {
    const channels = p.sales_channels || []
    // Exclude products in my own sales channel
    return !channels.some((sc: any) => sc.id === mySalesChannelId)
  })

  // Shuffle for discovery
  for (let i = discoverable.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[discoverable[i], discoverable[j]] = [discoverable[j], discoverable[i]]
  }

  const paginated = discoverable.slice(offset, offset + limit)

  res.json({
    products: paginated,
    count: discoverable.length,
    offset,
    limit,
  })
}
