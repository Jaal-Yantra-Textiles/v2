import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError, Modules } from "@medusajs/framework/utils"
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

  const paymentService = req.scope.resolve(Modules.PAYMENT) as any
  const providers = await paymentService.listPaymentProviders(
    req.query?.is_enabled ? { is_enabled: req.query.is_enabled === "true" } : {}
  )

  res.json({
    payment_providers: providers || [],
    count: providers?.length || 0,
    offset: 0,
    limit: 20,
  })
}
