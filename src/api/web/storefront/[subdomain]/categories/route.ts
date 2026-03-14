import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { subdomain } = req.params
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Look up partner by handle
  const { data: partners } = await query.graph({
    entity: "partners",
    fields: ["id", "stores.id"],
    filters: { handle: subdomain },
  })

  if (!partners?.length) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Storefront not found for subdomain '${subdomain}'`
    )
  }

  const stores = (partners[0] as any).stores || []
  if (!stores.length) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `No store configured for partner '${subdomain}'`
    )
  }

  const storeId = stores[0].id

  // Get store-linked categories
  const { data } = await query.graph({
    entity: "stores",
    fields: ["product_categories.*"],
    filters: { id: storeId },
  })

  const categories = (data?.[0] as any)?.product_categories || []

  res.json({
    product_categories: categories,
    count: categories.length,
  })
}
