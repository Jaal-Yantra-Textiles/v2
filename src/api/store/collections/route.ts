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
    return res.json({
      collections: [],
      count: 0,
    })
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "stores",
    fields: [
      "product_collections.*",
      "product_collections.products.*",
    ],
    filters: { id: store.id },
  })

  const collections = (data?.[0] as any)?.product_collections || []

  res.json({
    collections,
    count: collections.length,
  })
}
