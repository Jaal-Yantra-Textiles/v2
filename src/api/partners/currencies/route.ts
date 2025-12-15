import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../helpers"

type PartnerCurrenciesQuery = {
  limit?: number
  offset?: number
}

export const GET = async (
  req: AuthenticatedMedusaRequest<PartnerCurrenciesQuery>,
  res: MedusaResponse
) => {
  const actorId = req.auth_context?.actor_id
  if (!actorId) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Partner authentication required")
  }

  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner?.id) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "No partner associated with this admin")
  }

  const rawLimit = Number(req.query?.limit ?? 50)
  const rawOffset = Number(req.query?.offset ?? 0)
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 50
  const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0

  const currencyModule = req.scope.resolve(Modules.CURRENCY)
  const [currencies, count] = await currencyModule.listAndCountCurrencies(
    {},
    {
      skip: offset,
      take: limit,
    }
  )

  return res.status(200).json({
    partner_id: partner.id,
    currencies,
    count,
    limit,
    offset,
  })
}