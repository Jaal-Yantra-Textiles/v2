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

  // Outstanding convertibles (loans / SAFE / CCPS awaiting conversion into
  // shares) are money already put in but not yet equity. Fold their recorded
  // principal into "amount invested" so the figure reflects the investor's full
  // committed capital, grouped by cap table. Carried at cost (implied_value +=
  // principal) so the paper multiple stays coherent — converted/redeemed ones
  // are excluded (converted → already a stake; redeemed → paid back).
  const { data: convertibles } = await query.graph({
    entity: "convertible",
    filters: { cap_table_id: capTables.map((ct: any) => ct.id), status: "outstanding" },
    fields: ["principal_amount", "cap_table_id", "investor.id", "investor_id"],
  }).catch(() => ({ data: [] as any[] }))

  const outstandingByCt = new Map<string, number>()
  for (const c of convertibles || []) {
    const isMine = c?.investor?.id === investor.id || c?.investor_id === investor.id
    if (!isMine || !c?.cap_table_id) continue
    outstandingByCt.set(
      c.cap_table_id,
      (outstandingByCt.get(c.cap_table_id) || 0) + (Number(c.principal_amount) || 0)
    )
  }

  const positions = (capTables || []).map((ct: any) => {
    const stakes = (ct.stakes || []) as any[]
    const mine = stakes.filter(
      (s) => s.investor?.id === investor.id || s.investor_id === investor.id
    )

    // Only fully_paid (absorbed) equity counts — identical rule to the cap
    // table. Pending / rejected / not-followed-up stakes contribute nothing to
    // shares or invested, so the numbers stay consistent across every tab.
    const mineAbsorbed = mine.filter((s) => s.status === "fully_paid")
    const myShares = mineAbsorbed.reduce((sum, s) => sum + (Number(s.number_of_shares) || 0), 0)
    const convPrincipal = outstandingByCt.get(ct.id) || 0
    const myInvested =
      mineAbsorbed.reduce((sum, s) => sum + (Number(s.total_invested) || 0), 0) + convPrincipal

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
    const equityImplied =
      ownershipPct != null && postMoney != null
        ? Math.round((postMoney * ownershipPct) / 100)
        : null
    // Carry outstanding convertibles at cost (principal) in implied value.
    const impliedValue =
      equityImplied != null
        ? equityImplied + convPrincipal
        : convPrincipal > 0
        ? convPrincipal
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
      // Portion of my_invested that is outstanding convertible principal.
      outstanding_convertible_principal: convPrincipal,
      shares_outstanding: outstanding || null,
      ownership_pct: ownershipPct == null ? null : Math.round(ownershipPct * 100) / 100,
      post_money_valuation: postMoney,
      implied_value: impliedValue,
      multiple,
      stake_count: mineAbsorbed.length,
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
