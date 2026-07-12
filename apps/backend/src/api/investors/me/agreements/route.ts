import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { requireInvestor } from "../../helpers"
import { AGREEMENT_RESPONSE_MODULE } from "../../../../modules/agreement-responses"

// GET /investors/me/agreements — the subscription agreements issued to this
// investor (one per participation). Matched by the response's unique
// `email_sent_to` (== the investor's unique email). Body HTML is omitted from
// the list; fetch a single agreement to read/sign it.
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const investor = await requireInvestor(req.auth_context, req.scope)
  const responseSvc: any = req.scope.resolve(AGREEMENT_RESPONSE_MODULE)

  const responses = await responseSvc.listAgreementResponses(
    { email_sent_to: investor.email },
    { order: { sent_at: "DESC" } }
  )

  const agreements = (responses || []).map((r: any) => ({
    id: r.id,
    status: r.status,
    agreed: r.agreed,
    sent_at: r.sent_at,
    responded_at: r.responded_at,
    agreement_id: r.agreement_id,
    deal_name: r.metadata?.deal_name || null,
    company_name: r.metadata?.company_name || null,
    instrument_label: r.metadata?.instrument_label || null,
    amount_formatted: r.metadata?.amount_formatted || null,
  }))

  res.json({ agreements, count: agreements.length })
}
