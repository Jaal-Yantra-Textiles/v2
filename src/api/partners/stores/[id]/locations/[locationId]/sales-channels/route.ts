import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { validatePartnerStoreAccess } from "../../../../../helpers"

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { store } = await validatePartnerStoreAccess(
    req.auth_context,
    req.params.id,
    req.scope
  )

  const locationId = req.params.locationId
  if (store.default_location_id !== locationId) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Location not found for this store"
    )
  }

  const { add, remove } = req.body as { add?: string[]; remove?: string[] }
  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.LINK) as any

  if (add?.length) {
    for (const channelId of add) {
      await remoteLink.create({
        [Modules.STOCK_LOCATION]: { stock_location_id: locationId },
        [Modules.SALES_CHANNEL]: { sales_channel_id: channelId },
      })
    }
  }

  if (remove?.length) {
    for (const channelId of remove) {
      await remoteLink.dismiss({
        [Modules.STOCK_LOCATION]: { stock_location_id: locationId },
        [Modules.SALES_CHANNEL]: { sales_channel_id: channelId },
      })
    }
  }

  // Return updated location with sales channels
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: locations } = await query.graph({
    entity: "stock_locations",
    fields: ["*", "address.*", "sales_channels.*"],
    filters: { id: locationId },
  })

  res.json({ stock_location: locations?.[0] || { id: locationId } })
}
