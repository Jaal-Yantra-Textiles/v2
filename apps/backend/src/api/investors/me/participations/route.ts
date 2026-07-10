import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { requireInvestor } from "../../helpers"

// GET /investors/me/participations — the investor's stakes (participations),
// with the round + any payment (so the portal can surface a PayU pay link).
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const investor = await requireInvestor(req.auth_context, req.scope)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data } = await query.graph({
    entity: "stake",
    filters: { investor_id: investor.id },
    fields: [
      "*",
      "funding_round.name",
      "funding_round.round_type",
      "cap_table.company_id",
      "cap_table.name",
      "payments.id",
      "payments.amount",
      "payments.status",
      "payments.metadata",
    ],
  })
  res.json({ participations: data || [], count: (data || []).length })
}
