import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { AGREEMENT_RESPONSE_MODULE } from "../../../../../modules/agreement-responses"
import { AGREEMENTS_MODULE } from "../../../../../modules/agreements"

// POST /admin/agreement-responses/:id/mark-signed — an admin records that an
// agreement was signed (or declined) out-of-band: paper/e-sign done elsewhere,
// or verbal/confirmed acceptance the team is logging on the investor's behalf.
// Counterpart to the investor portal `/investors/me/agreements/:id/sign` and the
// token `/web/agreement/:id/respond` — same status transition + counter bump,
// but flagged in metadata as admin-recorded for an audit trail.
//
// Body: { agreed?: boolean (default true), notes?: string, signer_name?: string }
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const responseSvc: any = req.scope.resolve(AGREEMENT_RESPONSE_MODULE)
  const agreementsSvc: any = req.scope.resolve(AGREEMENTS_MODULE)

  const body = (req.body as any) || {}
  const agreed = body.agreed !== false // default to accept
  const notes = typeof body.notes === "string" ? body.notes : null
  const signerName =
    typeof body.signer_name === "string" ? body.signer_name : null

  const response = await responseSvc
    .retrieveAgreementResponse(req.params.id)
    .catch(() => null)
  if (!response) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Agreement not found")
  }
  if (response.status === "agreed" || response.status === "disagreed") {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "This agreement has already been responded to"
    )
  }

  const adminEmail =
    (req as any).auth_context?.actor_id ||
    (req as any).user?.email ||
    "admin"
  const ip =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    (req.socket as any)?.remoteAddress ||
    null

  const [updated] = await responseSvc.updateAgreementResponses({
    selector: { id: response.id },
    data: {
      status: agreed ? "agreed" : "disagreed",
      agreed,
      responded_at: new Date(),
      response_notes: notes,
      response_ip: ip,
      response_user_agent: "admin-dashboard",
      metadata: {
        ...(response.metadata || {}),
        signed_by_admin: true,
        signed_by_admin_email: adminEmail,
        signed_by_admin_at: new Date().toISOString(),
        signer_name: signerName || response.metadata?.signer_name || null,
      },
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
