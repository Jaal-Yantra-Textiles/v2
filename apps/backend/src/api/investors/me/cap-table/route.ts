import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { requireInvestor } from "../../helpers"

// GET /investors/me/cap-table — the cap tables of the companies this investor is
// linked to (via the investor pipeline), with share classes, funding rounds and
// stakes. Each stake is flagged `is_me` so the portal can highlight the
// investor's own ownership. This powers the investor-ui Cap table chart, which
// renders even before the investor has participated (empty allocations).
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
    return res.json({ cap_tables: [], count: 0 })
  }

  const { data: capTables } = await query.graph({
    entity: "cap_tables",
    filters: { company_id: companyIds },
    fields: [
      "*",
      "share_classes.*",
      "funding_rounds.*",
      "stakes.*",
      "stakes.investor.id",
      "stakes.investor.name",
      "stakes.share_class.name",
      "stakes.funding_round.name",
    ],
  })

  // Flag the investor's own stakes so the portal can highlight "You".
  const enriched = (capTables || []).map((ct: any) => ({
    ...ct,
    stakes: (ct.stakes || []).map((s: any) => ({
      ...s,
      is_me: s.investor?.id === investor.id || s.investor_id === investor.id,
    })),
  }))

  res.json({ cap_tables: enriched, count: enriched.length })
}
