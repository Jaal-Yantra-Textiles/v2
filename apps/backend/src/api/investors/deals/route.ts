import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { requireInvestor } from "../helpers"

// GET /investors/deals — open funding rounds (deals) for the companies this
// investor is linked to (via the investor pipeline).
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const investor = await requireInvestor(req.auth_context, req.scope)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: pipelines } = await query.graph({
    entity: "investor_pipeline",
    filters: { investor_id: investor.id },
    fields: ["company_id"],
  })
  const companyIds = [
    ...new Set((pipelines || []).map((p: any) => p.company_id).filter(Boolean)),
  ]
  if (!companyIds.length) {
    return res.json({ deals: [], count: 0 })
  }

  const { data: capTables } = await query.graph({
    entity: "cap_tables",
    filters: { company_id: companyIds },
    fields: ["id", "company_id", "name", "currency_code"],
  })
  const capIds = (capTables || []).map((c: any) => c.id)
  if (!capIds.length) {
    return res.json({ deals: [], count: 0 })
  }

  const { data: rounds } = await query.graph({
    entity: "funding_round",
    filters: { cap_table_id: capIds, status: "open" },
    fields: [
      "*",
      "cap_table.company_id",
      "cap_table.name",
      "cap_table.currency_code",
    ],
  })
  res.json({ deals: rounds || [], count: (rounds || []).length })
}
