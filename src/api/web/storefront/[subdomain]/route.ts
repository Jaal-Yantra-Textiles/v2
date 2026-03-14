import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { subdomain } = req.params
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Look up partner by handle
  const { data: partners } = await query.graph({
    entity: "partners",
    fields: ["*", "stores.*"],
    filters: { handle: subdomain },
  })

  if (!partners?.length) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Storefront not found for subdomain '${subdomain}'`
    )
  }

  const partner = partners[0]
  const stores = partner.stores || []

  if (!stores.length) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `No store configured for partner '${subdomain}'`
    )
  }

  const store = stores[0] as any
  const salesChannelId = store?.default_sales_channel_id

  if (!salesChannelId) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `No sales channel configured for partner '${subdomain}'`
    )
  }

  // Look up publishable API key linked to this sales channel
  const { data: apiKeys } = await query.graph({
    entity: "api_keys",
    fields: ["*", "sales_channels.*"],
    filters: { type: "publishable" },
  })

  const matchingKey = (apiKeys || []).find((key: any) => {
    const keySalesChannels = key.sales_channels || []
    return keySalesChannels.some((sc: any) => sc.id === salesChannelId)
  })

  res.status(200).json({
    partner: {
      name: partner.name,
      handle: partner.handle,
      logo: (partner as any).metadata?.logo || null,
    },
    store: {
      id: store.id,
      name: store.name,
      default_region_id: store.default_region_id,
    },
    publishable_key: matchingKey?.token || null,
    sales_channel_id: salesChannelId,
  })
}
