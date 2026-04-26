import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { createApiKeysWorkflow, linkSalesChannelsToApiKeyWorkflow } from "@medusajs/medusa/core-flows"
import { getPartnerFromAuthContext } from "../helpers"
import { PartnerCreateApiKeyReq } from "./validators"

async function getPartnerSalesChannelIds(partner: any, container: any): Promise<string[]> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "partners",
    fields: ["id", "stores.*"],
    filters: { id: partner.id },
  })

  const stores = data?.[0]?.stores || []
  return stores
    .map((s: any) => s.default_sales_channel_id)
    .filter(Boolean)
}

async function getApiKeysForSalesChannels(salesChannelIds: string[], container: any): Promise<any[]> {
  if (!salesChannelIds.length) return []

  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: apiKeys } = await query.graph({
    entity: "api_keys",
    fields: ["*", "sales_channels.*"],
    filters: { type: "publishable" },
  })

  return (apiKeys || []).filter((key: any) => {
    const keySalesChannels = key.sales_channels || []
    return keySalesChannels.some((sc: any) => salesChannelIds.includes(sc.id))
  })
}

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "No partner associated with this account"
    )
  }

  const salesChannelIds = await getPartnerSalesChannelIds(partner, req.scope)
  const apiKeys = await getApiKeysForSalesChannels(salesChannelIds, req.scope)

  res.json({
    api_keys: apiKeys,
    count: apiKeys.length,
    offset: 0,
    limit: 20,
  })
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "No partner associated with this account"
    )
  }

  const body = PartnerCreateApiKeyReq.parse(req.body)

  const salesChannelIds = await getPartnerSalesChannelIds(partner, req.scope)
  if (!salesChannelIds.length) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Partner has no store with a default sales channel"
    )
  }

  const { result } = await createApiKeysWorkflow(req.scope).run({
    input: {
      api_keys: [{
        title: body.title,
        type: "publishable",
        created_by: partner.id,
      }],
    },
  })

  const apiKey = result[0]

  await linkSalesChannelsToApiKeyWorkflow(req.scope).run({
    input: {
      id: apiKey.id,
      add: salesChannelIds,
    },
  })

  res.status(201).json({ api_key: apiKey })
}
