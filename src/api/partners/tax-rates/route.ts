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
  const filters: Record<string, any> = {}
  if (req.query?.tax_region_id) {
    filters.tax_region_id = req.query.tax_region_id
  }

  const { data: rates } = await query.graph({
    entity: "tax_rates",
    fields: ["*", "rules.*"],
    filters,
  })

  res.json({
    tax_rates: rates || [],
    count: rates?.length || 0,
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

  const body = req.body as Record<string, any>
  const taxService = req.scope.resolve(Modules.TAX) as any
  const rate = await taxService.createTaxRates(body)

  res.status(201).json({ tax_rate: rate })
}
