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

  if (!store.default_sales_channel_id) {
    return res.json({ sales_channels: [], count: 0, offset: 0, limit: 20 })
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: channels } = await query.graph({
    entity: "sales_channels",
    fields: ["*"],
    filters: { id: store.default_sales_channel_id },
  })

  res.json({
    sales_channels: channels || [],
    count: channels?.length || 0,
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
