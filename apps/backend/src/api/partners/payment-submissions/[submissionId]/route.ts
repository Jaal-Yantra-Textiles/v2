import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../../helpers"
import { PAYMENT_SUBMISSIONS_MODULE } from "../../../../modules/payment_submissions"
import PaymentSubmissionsService from "../../../../modules/payment_submissions/service"

// GET /partners/payment-submissions/:submissionId — get detail with items
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const actorId = req.auth_context?.actor_id
  if (!actorId) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Unauthorized")
  }

  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Unauthorized")
  }

  const { submissionId } = req.params
  const service: PaymentSubmissionsService = req.scope.resolve(
    PAYMENT_SUBMISSIONS_MODULE
  )

  const submissions = await service.listPaymentSubmissions(
    { id: [submissionId] },
    { relations: ["items"] }
  )

  const submission = submissions[0]
  if (!submission) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Payment submission not found: ${submissionId}`
    )
  }

  // Ensure partner owns this submission
  if (submission.partner_id !== partner.id) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "You do not have access to this submission"
    )
  }

  return res.status(200).json({ payment_submission: submission })
}
