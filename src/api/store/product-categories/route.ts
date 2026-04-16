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
      product_categories: [],
      count: 0,
    })
  }

  // Try store-linked categories first (partner storefronts create these links)
  const { data } = await query.graph({
    entity: "stores",
    fields: [
      "product_categories.*",
      "product_categories.category_children.*",
      "product_categories.parent_category.*",
      "product_categories.parent_category.parent_category.*",
      "product_categories.products.*",
    ],
    filters: { id: store.id },
  })

  let categories = (data?.[0] as any)?.product_categories || []

  // Fallback: if no categories are linked to the store, find them via
  // products in the sales channel (covers the main store where categories
  // were assigned via admin without explicit store links)
  if (!categories.length) {
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
          fields: ["categories.id"],
          filters: { id: productIds },
          pagination: { skip: 0, take: 9999 },
        })

        const categoryIds = new Set<string>()
        for (const p of products || []) {
          for (const cat of (p as any).categories || []) {
            if (cat.id) categoryIds.add(cat.id)
          }
        }

        if (categoryIds.size) {
          const { data: fallbackCategories } = await query.graph({
            entity: "product_category",
            fields: [
              "id", "name", "handle", "description",
              "is_active", "is_internal", "rank", "metadata",
              "parent_category.id", "parent_category.name", "parent_category.handle",
              "parent_category.parent_category.id", "parent_category.parent_category.name",
              "parent_category.parent_category.handle",
              "category_children.id", "category_children.name", "category_children.handle",
            ],
            filters: {
              id: Array.from(categoryIds),
              is_active: true,
              is_internal: false,
            },
          })
          categories = fallbackCategories || []
        }
      }
    }
  }

  res.json({
    product_categories: categories,
    count: categories.length,
  })
}
