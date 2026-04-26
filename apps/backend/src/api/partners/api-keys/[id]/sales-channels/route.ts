import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { linkSalesChannelsToApiKeyWorkflow } from "@medusajs/medusa/core-flows"
import { getPartnerFromAuthContext } from "../../../helpers"
import { PartnerBatchSalesChannelsReq } from "../../validators"

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
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Validate ownership
  const { data: partnerData } = await query.graph({
    entity: "partners",
    fields: ["id", "stores.*"],
    filters: { id: partner.id },
  })
  const stores = partnerData?.[0]?.stores || []
  const partnerSalesChannelIds = stores
    .map((s: any) => s.default_sales_channel_id)
    .filter(Boolean)

  const { data: apiKeys } = await query.graph({
    entity: "api_keys",
    fields: ["*", "sales_channels.*"],
    filters: { id },
  })

  if (!apiKeys?.length) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `API key ${id} not found`)
  }

  const apiKey = apiKeys[0]
  const ownsKey = (apiKey.sales_channels || []).some(
    (sc: any) => partnerSalesChannelIds.includes(sc.id)
  )

  if (!ownsKey) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `API key ${id} not found`)
  }

  const body = PartnerBatchSalesChannelsReq.parse(req.body)

  // Validate that sales channels being added belong to the partner
  if (body.add?.length) {
    const invalidChannels = body.add.filter(
      (scId) => !partnerSalesChannelIds.includes(scId)
    )
    if (invalidChannels.length) {
      throw new MedusaError(
        MedusaError.Types.UNAUTHORIZED,
        "Cannot link sales channels that do not belong to this partner"
      )
    }
  }

  await linkSalesChannelsToApiKeyWorkflow(req.scope).run({
    input: {
      id,
      add: body.add || [],
      remove: body.remove || [],
    },
  })

  // Re-fetch the updated key
  const { data: updatedKeys } = await query.graph({
    entity: "api_keys",
    fields: ["*", "sales_channels.*"],
    filters: { id },
  })

  res.json({ api_key: updatedKeys[0] })
}
