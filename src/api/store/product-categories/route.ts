import { MedusaStoreRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { getStoreFromPublishableKey } from "../helpers"

/**
 * GET /store/product-categories
 *
 * Replicates the framework's default category list handler with full query
 * parameter support (handle, q, limit, offset, fields, parent_category_id,
 * include_ancestors_tree, include_descendants_tree), but scopes results to
 * categories that belong to the requesting store.
 *
 * The applyCategoryFilters middleware (registered in middlewares.ts) injects
 * is_active: true and is_internal: false before this handler runs.
 */
export const GET = async (req: MedusaStoreRequest, res: MedusaResponse) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Resolve scoped category IDs
  const scopedIds = await getScopedCategoryIds(req)

  if (scopedIds !== null && scopedIds.length === 0) {
    return res.json({ product_categories: [], count: 0, offset: 0, limit: 50 })
  }

  // Inject scoped IDs into filterable fields
  const filters: Record<string, any> = { ...(req.filterableFields || {}) }
  if (scopedIds !== null) {
    if (filters.id) {
      const clientIds = Array.isArray(filters.id) ? filters.id : [filters.id]
      filters.id = clientIds.filter((id: string) => scopedIds.includes(id))
      if (filters.id.length === 0) {
        return res.json({ product_categories: [], count: 0, offset: 0, limit: 50 })
      }
    } else {
      filters.id = scopedIds
    }
  }

  // Standard Medusa query with full features
  const { data: product_categories, metadata } = await query.graph(
    {
      entity: "product_category",
      fields: (req as any).queryConfig?.fields || [
        "id", "name", "description", "handle", "rank",
        "parent_category_id", "created_at", "updated_at", "metadata",
        "*parent_category", "*category_children",
      ],
      filters,
      pagination: (req as any).queryConfig?.pagination,
    },
    { locale: (req as any).locale }
  )

  res.json({
    product_categories,
    count: metadata?.count ?? product_categories.length,
    offset: metadata?.skip ?? 0,
    limit: metadata?.take ?? 50,
  })
}

/**
 * Resolves category IDs visible to the current publishable key.
 * Returns null if no scoping is needed.
 */
async function getScopedCategoryIds(req: MedusaStoreRequest): Promise<string[] | null> {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const store = await getStoreFromPublishableKey(
    req.publishable_key_context!,
    req.scope
  )

  if (!store) return null

  // Path 1: Store-linked categories (partner storefronts)
  const { data } = await query.graph({
    entity: "stores",
    fields: ["product_categories.id"],
    filters: { id: store.id },
  })

  const linkedIds = ((data?.[0] as any)?.product_categories || [])
    .map((c: any) => c.id)
    .filter(Boolean)

  if (linkedIds.length) return linkedIds

  // Path 2: Sales-channel product fallback (main store)
  const salesChannelIds =
    (req as any).publishable_key_context?.sales_channel_ids || []

  if (!salesChannelIds.length) return []

  const { data: links } = await query.graph({
    entity: "product_sales_channel",
    fields: ["product_id"],
    filters: { sales_channel_id: salesChannelIds },
    pagination: { skip: 0, take: 9999 },
  })

  const productIds = (links || []).map((l: any) => l.product_id).filter(Boolean)
  if (!productIds.length) return []

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

  return Array.from(categoryIds)
}
