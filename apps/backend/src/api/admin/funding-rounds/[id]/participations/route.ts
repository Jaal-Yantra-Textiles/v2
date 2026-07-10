import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

// GET /admin/funding-rounds/:id/participations — investor participations (stakes)
// on this round, with investor + any payment (to show status / PayU link).
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "stake",
    filters: { funding_round_id: req.params.id },
    fields: [
      "*",
      "investor.id",
      "investor.name",
      "investor.email",
      "payments.id",
      "payments.amount",
      "payments.status",
      "payments.metadata",
    ],
  })
  res.json({ participations: data || [], count: (data || []).length })
}
