import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import {
  createProductCategoriesWorkflow,
} from "@medusajs/medusa/core-flows"
import { getPartnerStore } from "../helpers"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { store } = await getPartnerStore(req.auth_context, req.scope)

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "stores",
    fields: ["product_categories.*"],
    filters: { id: store.id },
  })

  const categories = (data?.[0] as any)?.product_categories || []

  res.json({
    product_categories: categories,
    count: categories.length,
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
