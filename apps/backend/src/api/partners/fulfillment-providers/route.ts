import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../helpers"

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

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: providers } = await query.graph({
    entity: "fulfillment_provider",
    fields: ["id", "is_enabled"],
  })

  // Only return enabled providers
  const enabled = (providers || []).filter((p: any) => p.is_enabled !== false)

  res.json({
    fulfillment_providers: enabled,
    count: enabled.length,
    offset: 0,
    limit: 20,
  })
}
