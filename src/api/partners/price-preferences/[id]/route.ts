import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../../helpers"

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
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: preferences } = await query.graph({
    entity: "price_preferences",
    fields: ["*"],
    filters: { id },
  })

  if (!preferences?.[0]) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Price preference ${id} not found`)
  }

  res.json({ price_preference: preferences[0] })
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
  const body = req.body as Record<string, any>
  const pricingService = req.scope.resolve(Modules.PRICING) as any
  const updated = await pricingService.updatePricePreferences(id, body)

  res.json({ price_preference: updated })
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
  const pricingService = req.scope.resolve(Modules.PRICING) as any
  await pricingService.deletePricePreferences(id)

  res.json({ id, object: "price_preference", deleted: true })
}
