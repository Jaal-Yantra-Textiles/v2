import { MedusaStoreRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { getStoreFromPublishableKey } from "../helpers"

/**
 * GET /store/collections
 *
 * Replicates the framework's default collection list handler with full query
 * parameter support (handle, q, limit, offset, order, fields), but scopes
 * results to collections that belong to the requesting store.
 *
 * Scoping strategy (tried in order):
 *   1. Store↔Collection links (partner storefronts create these explicitly)
 *   2. Sales-channel product fallback (main store — finds collections via products)
 *   3. Returns empty if neither path yields IDs
 */
export const GET = async (req: MedusaStoreRequest, res: MedusaResponse) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Resolve scoped collection IDs
  const scopedIds = await getScopedCollectionIds(req)

  if (scopedIds !== null && scopedIds.length === 0) {
    // Scoping resolved but found nothing
    return res.json({ collections: [], count: 0, offset: 0, limit: 10 })
  }

  // Inject scoped IDs into filterable fields (if scoping is active)
  const filters: Record<string, any> = { ...(req.filterableFields || {}) }
  if (scopedIds !== null) {
    // Merge with any client-provided id filter
    if (filters.id) {
      const clientIds = Array.isArray(filters.id) ? filters.id : [filters.id]
      filters.id = clientIds.filter((id: string) => scopedIds.includes(id))
      if (filters.id.length === 0) {
        return res.json({ collections: [], count: 0, offset: 0, limit: 10 })
      }
    } else {
      filters.id = scopedIds
    }
  }

  // Standard Medusa query with full pagination, ordering, field selection, and locale
  const { data: collections, metadata } = await query.graph(
    {
      entity: "product_collection",
      filters,
      pagination: (req as any).queryConfig?.pagination,
      fields: (req as any).queryConfig?.fields || [
        "id", "title", "handle", "created_at", "updated_at",
      ],
    },
    { locale: (req as any).locale }
  )

  res.json({
    collections,
    count: metadata?.count ?? collections.length,
    offset: metadata?.skip ?? 0,
    limit: metadata?.take ?? 10,
  })
}

/**
 * Resolves collection IDs that are visible to the current publishable key.
 * Returns null if no scoping is needed (no store context).
 */
async function getScopedCollectionIds(req: MedusaStoreRequest): Promise<string[] | null> {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const store = await getStoreFromPublishableKey(
    req.publishable_key_context!,
    req.scope
  )

  if (!store) return null

  // Path 1: Store-linked collections (partner storefronts)
  const { data } = await query.graph({
    entity: "stores",
    fields: ["product_collections.id"],
    filters: { id: store.id },
  })

  const linkedIds = ((data?.[0] as any)?.product_collections || [])
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
    fields: ["collection_id"],
    filters: { id: productIds },
    pagination: { skip: 0, take: 9999 },
  })

  const collectionIds = new Set<string>()
  for (const p of products || []) {
    if ((p as any).collection_id) collectionIds.add((p as any).collection_id)
  }

  return Array.from(collectionIds)
}
