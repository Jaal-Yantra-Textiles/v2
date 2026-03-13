import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { validatePartnerStoreAccess } from "../../../../helpers"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { store } = await validatePartnerStoreAccess(
    req.auth_context,
    req.params.id,
    req.scope
  )

  if (store.default_sales_channel_id !== req.params.channelId) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Sales channel not found for this store"
    )
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: channels } = await query.graph({
    entity: "sales_channels",
    fields: ["*"],
    filters: { id: req.params.channelId },
  })

  if (!channels?.[0]) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Sales channel not found")
  }

  res.json({ sales_channel: channels[0] })
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { store } = await validatePartnerStoreAccess(
    req.auth_context,
    req.params.id,
    req.scope
  )

  if (store.default_sales_channel_id !== req.params.channelId) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Sales channel not found for this store"
    )
  }

  const body = req.body as Record<string, any>
  const scService = req.scope.resolve(Modules.SALES_CHANNEL) as any
  const updated = await scService.updateSalesChannels({
    id: req.params.channelId,
    ...body,
  })

  res.json({ sales_channel: updated })
}

export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { store } = await validatePartnerStoreAccess(
    req.auth_context,
    req.params.id,
    req.scope
  )

  if (store.default_sales_channel_id !== req.params.channelId) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Sales channel not found for this store"
    )
  }

  const scService = req.scope.resolve(Modules.SALES_CHANNEL) as any
  await scService.deleteSalesChannels([req.params.channelId])

  res.json({ id: req.params.channelId, object: "sales_channel", deleted: true })
}
