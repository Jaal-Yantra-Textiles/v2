import { MedusaStoreRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { getStoreFromPublishableKey } from "../helpers"

export const GET = async (
  req: MedusaStoreRequest,
  res: MedusaResponse
) => {
  const store = await getStoreFromPublishableKey(
    req.publishable_key_context!,
    req.scope
  )

  if (!store) {
    // No store found — return empty list
    return res.json({
      product_categories: [],
      count: 0,
    })
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
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

  const categories = (data?.[0] as any)?.product_categories || []

  res.json({
    product_categories: categories,
    count: categories.length,
  })
}
