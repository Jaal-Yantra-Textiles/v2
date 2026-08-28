import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { PAYMENT_SUBMISSIONS_MODULE } from "../../../../modules/payment_submissions"
import PaymentSubmissionsService from "../../../../modules/payment_submissions/service"
import { deletePaymentSubmissionWorkflow } from "../../../../workflows/payment_submissions/delete-payment-submission"

// GET /admin/payment-submissions/:id — get submission detail
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params

  const service: PaymentSubmissionsService = req.scope.resolve(
    PAYMENT_SUBMISSIONS_MODULE
  )

  const submissions = await service.listPaymentSubmissions(
    { id: [id] },
    { relations: ["items"] }
  )

  const submission = submissions[0]
  if (!submission) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Payment submission not found: ${id}`
    )
  }

  return res.status(200).json({ payment_submission: submission })
}

// DELETE /admin/payment-submissions/:id — remove a Draft (#1604)
//
// Draft only. See `deletePaymentSubmissionWorkflow` for why anything else is
// refused rather than soft-deleted: a Pending claim is reviewed, and an
// Approved or Paid one is the record of money that already moved.
export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params

  const { result } = await deletePaymentSubmissionWorkflow(req.scope).run({
    input: { submission_id: id },
  })

  return res.status(200).json({
    id: result.id,
    object: "payment_submission",
    deleted: result.deleted,
  })
}
