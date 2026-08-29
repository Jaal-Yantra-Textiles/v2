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
    /**
     * `payment` is always null now — approval stops creating an
     * `internal_payments` row and the submission IS the payout record (#1636).
     * The key is kept so existing callers do not see their shape change; the
     * method the payout went to is reported alongside it.
     */
    payment: null,
    paid_to: (result as any).paid_to ?? null,
  })
}
