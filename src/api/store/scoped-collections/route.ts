import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * GET /store/scoped-collections
 *
 * Returns only collections that contain products linked to the
 * requesting publishable API key's sales channel.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Get sales channel IDs from the publishable key context
  const salesChannelIds =
    (req as any).publishable_key_context?.sales_channel_ids || []

  if (!salesChannelIds.length) {
    return res.json({
      collections: [],
      count: 0,
      offset: 0,
      limit: 50,
    })
  }

  // Find product IDs in this sales channel
  const { data: links } = await query.graph({
    entity: "product_sales_channel",
    fields: ["product_id"],
    filters: { sales_channel_id: salesChannelIds },
    pagination: { skip: 0, take: 9999 },
  })

  const productIds = (links || []).map((l: any) => l.product_id).filter(Boolean)

  if (!productIds.length) {
    return res.json({
      collections: [],
      count: 0,
      offset: 0,
      limit: 50,
    })
  }

  // Find collection IDs from these products
  const { data: products } = await query.graph({
    entity: "product",
    fields: ["collection_id"],
    filters: { id: productIds },
    pagination: { skip: 0, take: 9999 },
  })

  const collectionIds = new Set<string>()
  for (const p of products || []) {
    if ((p as any).collection_id) {
      collectionIds.add((p as any).collection_id)
    }
  }

  if (!collectionIds.size) {
    return res.json({
      collections: [],
      count: 0,
      offset: 0,
      limit: 50,
    })
  }

  // Fetch full collection data
  const { data: collections } = await query.graph({
    entity: "product_collection",
    fields: [
      "id",
      "title",
      "handle",
      "metadata",
      "created_at",
      "updated_at",
    ],
    filters: { id: Array.from(collectionIds) },
  })

  res.json({
    collections: collections || [],
    count: collections?.length || 0,
    offset: 0,
    limit: 50,
  })
}
