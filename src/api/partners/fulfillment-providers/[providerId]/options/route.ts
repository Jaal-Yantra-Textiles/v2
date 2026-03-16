import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../../../helpers"

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

  const providerId = req.params.providerId
  const fulfillmentModule = req.scope.resolve(Modules.FULFILLMENT) as any

  const options = await fulfillmentModule.retrieveFulfillmentOptions(providerId)
  res.json({ fulfillment_options: options || [] })
}
