import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { updateApiKeysWorkflow, deleteApiKeysWorkflow, revokeApiKeysWorkflow } from "@medusajs/medusa/core-flows"
import { getPartnerFromAuthContext } from "../../helpers"
import { PartnerUpdateApiKeyReq } from "../validators"

async function validateApiKeyOwnership(partner: any, apiKeyId: string, container: any) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  // Get partner's sales channel IDs
  const { data: partnerData } = await query.graph({
    entity: "partners",
    fields: ["id", "stores.*"],
    filters: { id: partner.id },
  })
  const stores = partnerData?.[0]?.stores || []
  const salesChannelIds = stores
    .map((s: any) => s.default_sales_channel_id)
    .filter(Boolean)

  if (!salesChannelIds.length) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `API key ${apiKeyId} not found`)
  }

  // Get the API key with its sales channels
  const { data: apiKeys } = await query.graph({
    entity: "api_keys",
    fields: ["*", "sales_channels.*"],
    filters: { id: apiKeyId },
  })

  if (!apiKeys?.length) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `API key ${apiKeyId} not found`)
  }

  const apiKey = apiKeys[0]
  const keySalesChannels = apiKey.sales_channels || []
  const ownsKey = keySalesChannels.some((sc: any) => salesChannelIds.includes(sc.id))

  if (!ownsKey) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `API key ${apiKeyId} not found`)
  }

  return apiKey
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

  const { id } = req.params
  const apiKey = await validateApiKeyOwnership(partner, id, req.scope)

  res.json({ api_key: apiKey })
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

  const { id } = req.params
  await validateApiKeyOwnership(partner, id, req.scope)

  const body = PartnerUpdateApiKeyReq.parse(req.body)

  const { result } = await updateApiKeysWorkflow(req.scope).run({
    input: {
      selector: { id },
      update: { title: body.title },
    },
  })

  res.json({ api_key: result[0] })
}

export const DELETE = async (
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

  const { id } = req.params
  const apiKey = await validateApiKeyOwnership(partner, id, req.scope)

  // #1184 — Medusa's api-key module refuses to delete a publishable key that is
  // still live (NOT_ALLOWED → 400), so DELETE never actually deleted anything.
  // Revoke first when needed; an already-revoked key skips straight to delete.
  if (!apiKey.revoked_at) {
    await revokeApiKeysWorkflow(req.scope).run({
      input: {
        selector: { id },
        revoke: { revoked_by: partner.id },
      },
    })
  }

  await deleteApiKeysWorkflow(req.scope).run({
    input: { ids: [id] },
  })

  res.json({ id, object: "api_key", deleted: true })
}
