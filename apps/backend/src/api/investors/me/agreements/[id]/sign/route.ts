import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { requireInvestor } from "../../../../helpers"
import { AGREEMENT_RESPONSE_MODULE } from "../../../../../../modules/agreement-responses"
import { AGREEMENTS_MODULE } from "../../../../../../modules/agreements"

// POST /investors/me/agreements/:id/sign — the investor accepts (or declines)
// their subscription agreement from the portal. Auth is the investor session
// (email-matched), not the emailed access token; the token path still works via
// the generic /web/agreement/:id/respond endpoint for out-of-portal signing.
export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const investor = await requireInvestor(req.auth_context, req.scope)
  const responseSvc: any = req.scope.resolve(AGREEMENT_RESPONSE_MODULE)
  const agreementsSvc: any = req.scope.resolve(AGREEMENTS_MODULE)

  const body = (req.body as any) || {}
  const agreed = body.agreed !== false // default to accept
  const notes = typeof body.notes === "string" ? body.notes : null

  const response = await responseSvc
    .retrieveAgreementResponse(req.params.id)
    .catch(() => null)
  if (!response || response.email_sent_to !== investor.email) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Agreement not found")
  }
  if (response.status === "agreed" || response.status === "disagreed") {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "You have already responded to this agreement"
    )
  }

  const ip =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    (req.socket as any)?.remoteAddress ||
    null
  const userAgent = (req.headers["user-agent"] as string) || null

  const [updated] = await responseSvc.updateAgreementResponses({
    selector: { id: response.id },
    data: {
      status: agreed ? "agreed" : "disagreed",
      agreed,
      responded_at: new Date(),
      response_notes: notes,
      response_ip: ip,
      response_user_agent: userAgent,
    },
  })

  // Bump agreement counters (best-effort).
  try {
    const [agreement] = await agreementsSvc.listAgreements({
      id: response.agreement_id,
    })
    if (agreement) {
      await agreementsSvc.updateAgreements({
        selector: { id: agreement.id },
        data: {
          response_count: (agreement.response_count || 0) + 1,
          agreed_count: (agreement.agreed_count || 0) + (agreed ? 1 : 0),
        },
      })
    }
  } catch {
    /* non-fatal */
  }

  res.json({
    agreement: {
      id: updated.id,
      status: updated.status,
      agreed: updated.agreed,
      responded_at: updated.responded_at,
    },
  })
}
