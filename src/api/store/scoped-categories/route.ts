import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * GET /store/scoped-categories
 *
 * Returns only categories that contain products linked to the
 * requesting publishable API key's sales channel.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Get sales channel IDs from the publishable key context
  const salesChannelIds =
    (req as any).publishable_key_context?.sales_channel_ids || []

  if (!salesChannelIds.length) {
    return res.json({
      product_categories: [],
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
      product_categories: [],
      count: 0,
      offset: 0,
      limit: 50,
    })
  }

  // Find categories that have these products
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

  if (!categoryIds.size) {
    return res.json({
      product_categories: [],
      count: 0,
      offset: 0,
      limit: 50,
    })
  }

  // Fetch full category data for the matched IDs
  const { data: categories } = await query.graph({
    entity: "product_category",
    fields: [
      "id",
      "name",
      "handle",
      "description",
      "is_active",
      "is_internal",
      "rank",
      "metadata",
      "parent_category.id",
      "parent_category.name",
      "parent_category.handle",
      "parent_category.parent_category.id",
      "parent_category.parent_category.name",
      "parent_category.parent_category.handle",
      "category_children.id",
      "category_children.name",
      "category_children.handle",
    ],
    filters: {
      id: Array.from(categoryIds),
      is_active: true,
      is_internal: false,
    },
  })

  res.json({
    product_categories: categories || [],
    count: categories?.length || 0,
    offset: 0,
    limit: 50,
  })
}
