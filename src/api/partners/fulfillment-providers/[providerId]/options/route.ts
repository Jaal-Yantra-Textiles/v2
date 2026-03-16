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

  try {
    // Try the module's method to list provider options
    const options = await fulfillmentModule.listFulfillmentOptions(providerId)
    res.json({ fulfillment_options: options || [] })
  } catch {
    // Fallback: resolve the provider directly and call getFulfillmentOptions
    try {
      const providerService = fulfillmentModule.retrieveFulfillmentProvider
        ? await fulfillmentModule.retrieveFulfillmentProvider(providerId)
        : null

      if (providerService?.getFulfillmentOptions) {
        const options = await providerService.getFulfillmentOptions()
        res.json({ fulfillment_options: options || [] })
      } else {
        // Return empty — provider doesn't expose options
        res.json({ fulfillment_options: [] })
      }
    } catch {
      res.json({ fulfillment_options: [] })
    }
  }
}
