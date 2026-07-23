import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { requireInvestor } from "../../helpers"
import { computeConvertibleValue } from "../../../../modules/investor/lib/convertible-value"

// GET /investors/me/convertibles — the SAFEs / convertible notes held by the
// authenticated investor, each with a derived value (principal, implied
// ownership, implied current value) against the company's post-money valuation.
// Powers the investor-ui "My SAFEs" view — how a SAFE holder with no shares
// still sees what their investment is worth, current and past.
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const investor = await requireInvestor(req.auth_context, req.scope)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data } = await query.graph({
    entity: "convertible",
    filters: { investor_id: investor.id },
    fields: [
      "*",
      "cap_table.id",
      "cap_table.name",
      "cap_table.company_id",
      "cap_table.post_money_valuation",
      "cap_table.currency_code",
      "payments.id",
      "payments.amount",
      "payments.status",
      "payments.paid_date",
    ],
  })

  const convertibles = (data || []).map((c: any) => ({
    ...c,
    value: computeConvertibleValue(c, {
      referenceValuation: c.cap_table?.post_money_valuation,
    }),
  }))

  // Portfolio roll-up so the UI can show a headline number.
  const summary = convertibles.reduce(
    (acc: any, c: any) => {
      acc.total_principal += c.value.principal || 0
      acc.total_implied_value += c.value.implied_value || 0
      if (c.status === "outstanding") acc.outstanding_count += 1
      return acc
    },
    { total_principal: 0, total_implied_value: 0, outstanding_count: 0 }
  )

  res.json({ convertibles, count: convertibles.length, summary })
}
