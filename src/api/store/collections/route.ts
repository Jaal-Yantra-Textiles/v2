import { MedusaStoreRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { getStoreFromPublishableKey } from "../helpers"

export const GET = async (
  req: MedusaStoreRequest,
  res: MedusaResponse
) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const store = await getStoreFromPublishableKey(
    req.publishable_key_context!,
    req.scope
  )

  if (!store) {
    return res.json({
      collections: [],
      count: 0,
    })
  }

  // Try store-linked collections first (partner storefronts create these links)
  const { data } = await query.graph({
    entity: "stores",
    fields: [
      "product_collections.*",
      "product_collections.products.*",
    ],
    filters: { id: store.id },
  })

  let collections = (data?.[0] as any)?.product_collections || []

  // Fallback: if no collections are linked to the store, find them via
  // products in the sales channel (covers the main store where collections
  // were created via admin without explicit store links)
  if (!collections.length) {
    const salesChannelIds =
      (req as any).publishable_key_context?.sales_channel_ids || []

    if (salesChannelIds.length) {
      const { data: links } = await query.graph({
        entity: "product_sales_channel",
        fields: ["product_id"],
        filters: { sales_channel_id: salesChannelIds },
        pagination: { skip: 0, take: 9999 },
      })

      const productIds = (links || []).map((l: any) => l.product_id).filter(Boolean)

      if (productIds.length) {
        const { data: products } = await query.graph({
          entity: "product",
          fields: ["collection_id"],
          filters: { id: productIds },
          pagination: { skip: 0, take: 9999 },
        })

        const collectionIds = new Set<string>()
        for (const p of products || []) {
          if ((p as any).collection_id) collectionIds.add((p as any).collection_id)
        }

        if (collectionIds.size) {
          const { data: fallbackCollections } = await query.graph({
            entity: "product_collection",
            fields: ["id", "title", "handle", "metadata", "created_at", "updated_at"],
            filters: { id: Array.from(collectionIds) },
          })
          collections = fallbackCollections || []
        }
      }
    }
  }

  res.json({
    collections,
    count: collections.length,
  })
}
