import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { requireInvestor } from "../../../helpers"
import { AGREEMENT_RESPONSE_MODULE } from "../../../../../modules/agreement-responses"
import { AGREEMENTS_MODULE } from "../../../../../modules/agreements"

// GET /investors/me/agreements/:id — a single agreement issued to this investor,
// with the rendered HTML body to review before signing. Ownership is enforced
// by matching the response's `email_sent_to` to the authenticated investor.
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const investor = await requireInvestor(req.auth_context, req.scope)
  const responseSvc: any = req.scope.resolve(AGREEMENT_RESPONSE_MODULE)
  const agreementsSvc: any = req.scope.resolve(AGREEMENTS_MODULE)

  const response = await responseSvc
    .retrieveAgreementResponse(req.params.id)
    .catch(() => null)
  if (!response || response.email_sent_to !== investor.email) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Agreement not found")
  }

  const [agreement] = await agreementsSvc.listAgreements({
    id: response.agreement_id,
  })

  res.json({
    agreement: {
      id: response.id,
      status: response.status,
      agreed: response.agreed,
      sent_at: response.sent_at,
      viewed_at: response.viewed_at,
      responded_at: response.responded_at,
      title: agreement?.title || response.metadata?.instrument_label || "Agreement",
      subject: response.metadata?.rendered_subject || agreement?.subject || "",
      content: response.metadata?.rendered_html || agreement?.content || "",
      deal_name: response.metadata?.deal_name || null,
      company_name: response.metadata?.company_name || null,
      instrument_label: response.metadata?.instrument_label || null,
      amount_formatted: response.metadata?.amount_formatted || null,
    },
  })
}
