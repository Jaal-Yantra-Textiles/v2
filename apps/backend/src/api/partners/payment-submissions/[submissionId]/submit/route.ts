import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"

import { getPartnerFromAuthContext } from "../../../helpers"
import { submitPaymentSubmissionWorkflow } from "../../../../../workflows/payment_submissions/submit-payment-submission"

/**
 * POST /partners/payment-submissions/:submissionId/submit
 *
 * Turn one of this partner's Draft submissions into a real claim — the route
 * `create-payment-submission` documents as the intended path but that never
 * existed (#1604). Ownership is checked twice on purpose: here, so the refusal
 * is a clean 403 before any workflow runs, and again inside the workflow, so a
 * future caller cannot reach the transition without it.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  if (!req.auth_context?.actor_id) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Unauthorized")
  }

  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Unauthorized")
  }

  const { submissionId } = req.params
  const body = (req.validatedBody || {}) as { notes?: string }

  const { result } = await submitPaymentSubmissionWorkflow(req.scope).run({
    input: {
      submission_id: submissionId,
      expected_partner_id: partner.id,
      notes: body.notes,
    },
  })

  return res.status(200).json({ payment_submission: result.submission })
}
