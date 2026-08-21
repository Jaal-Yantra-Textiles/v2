import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import {
  createProductCategoriesWorkflow,
} from "@medusajs/medusa/core-flows"
import { getPartnerStore, tryGetPartnerStore } from "../helpers"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { store } = await tryGetPartnerStore(req.auth_context, req.scope)
  if (!store) {
    return res.json({ product_categories: [], count: 0, offset: 0, limit: 20 })
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Get linked category IDs from the store
  const { data: storeData } = await query.graph({
    entity: "stores",
    fields: ["product_categories.id"],
    filters: { id: store.id },
  })

  const linkedIds = ((storeData?.[0] as any)?.product_categories || []).map(
    (c: any) => c.id
  )

  if (!linkedIds.length) {
    return res.json({
      product_categories: [],
      count: 0,
      offset: 0,
      limit: 20,
    })
  }

  // Parse query params (the partner route has no zod middleware, so read raw)
  const rawQuery = (req.query || {}) as Record<string, any>
  const q = rawQuery.q as string | undefined
  const parentCategoryId = rawQuery.parent_category_id as string | undefined
  const includeDescendantsTree =
    rawQuery.include_descendants_tree === true ||
    rawQuery.include_descendants_tree === "true"
  const includeAncestorsTree =
    rawQuery.include_ancestors_tree === true ||
    rawQuery.include_ancestors_tree === "true"
  const limit = Math.min(parseInt(rawQuery.limit as string) || 50, 200)
  const offset = parseInt(rawQuery.offset as string) || 0

  // Build filters combining store scope with query params.
  // The product module service (ProductCategoryService.list) natively handles
  // include_descendants_tree and include_ancestors_tree by extracting them
  // as transformOptions before querying MikroORM — same as the admin route.
  const filters: any = { id: linkedIds }
  if (q) filters.q = q
  if (parentCategoryId === "null") {
    filters.parent_category_id = null
  } else if (parentCategoryId && parentCategoryId !== "undefined") {
    filters.parent_category_id = parentCategoryId
  }
  if (includeDescendantsTree) filters.include_descendants_tree = true
  if (includeAncestorsTree) filters.include_ancestors_tree = true

  const { data: categories, metadata } = await query.graph({
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
      "created_at",
      "updated_at",
      "parent_category.*",
      "category_children.*",
    ],
    filters,
    pagination: {
      skip: offset,
      take: limit,
    },
  })

  res.json({
    product_categories: categories || [],
    count: metadata?.count ?? categories?.length ?? 0,
    offset: metadata?.skip ?? offset,
    limit: metadata?.take ?? limit,
  })
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { store } = await getPartnerStore(req.auth_context, req.scope)

  const { result } = await createProductCategoriesWorkflow(req.scope).run({
    input: {
      product_categories: [req.body as any],
    },
  })

  const category = result[0]

  // Link category to store
  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.LINK) as any
  await remoteLink.create({
    [Modules.STORE]: { store_id: store.id },
    [Modules.PRODUCT]: { product_category_id: category.id },
  })

  res.status(201).json({ product_category: category })
}
