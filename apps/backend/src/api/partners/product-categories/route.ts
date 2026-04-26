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

  // First get linked category IDs from the store
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

  // Then fetch full category data
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
      "created_at",
      "updated_at",
      "parent_category.id",
      "parent_category.name",
      "category_children.id",
      "category_children.name",
    ],
    filters: { id: linkedIds },
  })

  res.json({
    product_categories: categories || [],
    count: categories?.length || 0,
    offset: 0,
    limit: 20,
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
