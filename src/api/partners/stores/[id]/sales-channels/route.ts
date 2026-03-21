import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createSalesChannelsWorkflow } from "@medusajs/medusa/core-flows"
import { validatePartnerStoreAccess } from "../../../helpers"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { store } = await validatePartnerStoreAccess(
    req.auth_context,
    req.params.id,
    req.scope
  )

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  if (!store.default_location_id) {
    // Fallback: return just the default sales channel if no location is set
    if (!store.default_sales_channel_id) {
      return res.json({ sales_channels: [], count: 0, offset: 0, limit: 20 })
    }
    const { data: channels } = await query.graph({
      entity: "sales_channels",
      fields: ["*"],
      filters: { id: store.default_sales_channel_id },
    })
    return res.json({
      sales_channels: channels || [],
      count: channels?.length || 0,
      offset: 0,
      limit: 20,
    })
  }

  // Get all sales channels linked to this partner's stock location(s)
  // This uses the sales_channel_stock_location link table for partner scoping
  const { data: locations } = await query.graph({
    entity: "stock_locations",
    fields: ["sales_channels.*"],
    filters: { id: store.default_location_id },
  })

  const channels = locations?.[0]?.sales_channels || []

  // Also include the default sales channel if it's not already in the list
  if (store.default_sales_channel_id) {
    const hasDefault = channels.some((c: any) => c.id === store.default_sales_channel_id)
    if (!hasDefault) {
      const { data: defaultChannels } = await query.graph({
        entity: "sales_channels",
        fields: ["*"],
        filters: { id: store.default_sales_channel_id },
      })
      if (defaultChannels?.[0]) {
        channels.unshift(defaultChannels[0])
      }
    }
  }

  res.json({
    sales_channels: channels,
    count: channels.length,
    offset: 0,
    limit: 20,
  })
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerStoreAccess(
    req.auth_context,
    req.params.id,
    req.scope
  )

  const body = req.body as Record<string, any>

  const { result } = await createSalesChannelsWorkflow(req.scope).run({
    input: {
      salesChannelsData: [body] as any,
    },
  })

  res.status(201).json({ sales_channel: result[0] })
}
