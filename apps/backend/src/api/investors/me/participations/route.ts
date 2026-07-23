import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { requireInvestor } from "../../helpers"

// GET /investors/me/participations — the investor's participations, with the
// round + any payment (so the portal can surface a PayU pay link and reflect
// settlement). Equity rounds yield `stake` participations; SAFE / convertible /
// CCPS rounds yield `convertible` ones — both are returned with a `type`
// discriminator and a normalised `total_invested` so one table renders both.
// Whether a participation counts as *paid* is derived from its payments (a
// `completed` payment), not the instrument status — a convertible stays
// "outstanding" once paid.
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const investor = await requireInvestor(req.auth_context, req.scope)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const [{ data: stakes }, { data: convertibles }] = await Promise.all([
    query.graph({
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
    }),
    query
      .graph({
        entity: "convertible",
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
      .catch(() => ({ data: [] as any[] })),
  ])

  const participations = [
    ...(stakes || []).map((s: any) => ({ ...s, type: "stake" })),
    ...(convertibles || []).map((c: any) => ({
      ...c,
      type: "convertible",
      // Normalise so the UI renders one "Amount" column: SAFEs carry `principal_amount`.
      total_invested: c.principal_amount,
    })),
  ]

  res.json({ participations, count: participations.length })
}
