import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { submitPaymentSubmissionWorkflow } from "../../../../../workflows/payment_submissions/submit-payment-submission"

/**
 * POST /admin/payment-submissions/:id/submit
 *
 * The same Draft → Pending transition, on the admin side. It exists because a
 * partner is not the only one who gets stuck: production accumulated seven
 * machine-written Drafts with no route out of them, and unsticking those is an
 * operator action. No `expected_partner_id` — an admin may submit on any
 * partner's behalf, and the guards that matter are the claim guards, not
 * ownership.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params
  const body = (req.validatedBody || {}) as { notes?: string }

  const { result } = await submitPaymentSubmissionWorkflow(req.scope).run({
    input: {
      submission_id: id,
      notes: body.notes,
    },
  })

  return res.status(200).json({ payment_submission: result.submission })
}
