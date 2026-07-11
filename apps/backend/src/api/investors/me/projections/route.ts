import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { requireInvestor } from "../../helpers"

// GET /investors/me/projections — the investor's OWN position, per cap table and
// as a portfolio total. This is deliberately bespoke (not a shared stats panel)
// because every figure is scoped to the authenticated investor:
//   ownership_pct = my_shares / shares_outstanding
//   implied_value = ownership_pct × post_money_valuation
//   multiple      = implied_value / my_invested   (paper MOIC)
// Companies are resolved through the investor pipeline, exactly like
// /investors/me/cap-table.
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
    return res.json({ positions: [], portfolio: emptyPortfolio(), count: 0 })
  }

  const { data: capTables } = await query.graph({
    entity: "cap_tables",
    filters: { company_id: companyIds },
    fields: [
      "id",
      "name",
      "company_id",
      "currency_code",
      "total_shares_outstanding",
      "fully_diluted_shares",
      "post_money_valuation",
      "stakes.*",
      "stakes.investor.id",
    ],
  })

  const positions = (capTables || []).map((ct: any) => {
    const stakes = (ct.stakes || []) as any[]
    const mine = stakes.filter(
      (s) => s.investor?.id === investor.id || s.investor_id === investor.id
    )

    const myShares = mine.reduce((sum, s) => sum + (Number(s.number_of_shares) || 0), 0)
    const myInvested = mine.reduce((sum, s) => sum + (Number(s.total_invested) || 0), 0)

    // Prefer the recorded outstanding total; fall back to the sum of every
    // stake's shares so ownership is still meaningful on a lightly-maintained
    // cap table.
    const outstanding =
      Number(ct.total_shares_outstanding) ||
      Number(ct.fully_diluted_shares) ||
      stakes.reduce((sum, s) => sum + (Number(s.number_of_shares) || 0), 0)

    const ownershipPct =
      outstanding > 0 ? (myShares / outstanding) * 100 : null
    const postMoney = Number(ct.post_money_valuation) || null
    const impliedValue =
      ownershipPct != null && postMoney != null
        ? Math.round((postMoney * ownershipPct) / 100)
        : null
    const multiple =
      impliedValue != null && myInvested > 0
        ? Math.round((impliedValue / myInvested) * 100) / 100
        : null

    return {
      cap_table_id: ct.id,
      cap_table_name: ct.name,
      company_id: ct.company_id,
      currency_code: ct.currency_code ?? null,
      my_shares: myShares,
      my_invested: myInvested,
      shares_outstanding: outstanding || null,
      ownership_pct: ownershipPct == null ? null : Math.round(ownershipPct * 100) / 100,
      post_money_valuation: postMoney,
      implied_value: impliedValue,
      multiple,
      stake_count: mine.length,
    }
  })

  const portfolio = positions.reduce(
    (acc, p) => {
      acc.total_invested += p.my_invested
      acc.total_implied_value += p.implied_value ?? 0
      acc.cap_tables += 1
      return acc
    },
    emptyPortfolio()
  )
  portfolio.blended_multiple =
    portfolio.total_invested > 0
      ? Math.round((portfolio.total_implied_value / portfolio.total_invested) * 100) / 100
      : null

  res.json({ positions, portfolio, count: positions.length })
}

function emptyPortfolio() {
  return {
    total_invested: 0,
    total_implied_value: 0,
    blended_multiple: null as number | null,
    cap_tables: 0,
  }
}
