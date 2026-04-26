import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { reviewPaymentSubmissionWorkflow } from "../../../../../workflows/payment_submissions/review-payment-submission"

// POST /admin/payment-submissions/:id/review — approve or reject
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params
  const body = req.validatedBody as any

  const reviewedBy = (req as any).auth_context?.actor_id || "admin"

  const { result } = await reviewPaymentSubmissionWorkflow(req.scope).run({
    input: {
      submission_id: id,
      action: body.action,
      reviewed_by: reviewedBy,
      rejection_reason: body.rejection_reason,
      amount_override: body.amount_override,
      payment_type: body.payment_type,
      paid_to_id: body.paid_to_id,
      notes: body.notes,
    },
  })

  return res.status(200).json({
    payment_submission: result.submission,
    payment: result.payment || null,
  })
}
