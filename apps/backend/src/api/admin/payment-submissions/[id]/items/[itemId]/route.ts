import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { updatePaymentSubmissionItemWorkflow } from "../../../../../../workflows/payment_submissions/update-payment-submission-item"

/**
 * PATCH /admin/payment-submissions/:id/items/:itemId — correct one line (#1604)
 *
 * The route `audit-partner-payout-quantity` already presupposes: it reports the
 * lines that need a human decision and refuses to write them itself, because
 * "the correction is a payment decision rather than a data repair". This is
 * where that decision lands.
 *
 * Admin only. Partners get reject → resubmit, which works correctly; giving
 * them an edit reopens the double-bill surface #1602 closed.
 */
export const PATCH = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id, itemId } = req.params
  const body = req.validatedBody as any

  const { result } = await updatePaymentSubmissionItemWorkflow(req.scope).run({
    input: {
      submission_id: id,
      item_id: itemId,
      quantity: body.quantity,
      unit_amount: body.unit_amount,
      amount: body.amount,
      production_run_ids: body.production_run_ids,
      metadata: body.metadata,
    },
  })

  return res.status(200).json({ payment_submission: result.submission })
}
