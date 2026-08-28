import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { MedusaError } from "@medusajs/framework/utils"

import { PAYMENT_SUBMISSIONS_MODULE } from "../../modules/payment_submissions"
import PaymentSubmissionsService from "../../modules/payment_submissions/service"

/**
 * Remove a Draft payment submission (#1604).
 *
 * ## Draft only, and that restriction is the safety
 *
 * A Draft is machine-written: `auto-draft-payment-submission` mints one on
 * every completed run, and when the sweep produces a bad one — the wrong
 * design, a duplicate of a redo, a run whose price was later corrected — there
 * was no way to remove it. They accumulate: seven of production's fifteen
 * submissions are Drafts.
 *
 * Everything else is a decision somebody made. A Pending claim is a partner
 * asking to be paid and its exit is `review`; an Approved or Paid submission is
 * the record of money that moved, and deleting that record does not un-move it.
 * So this refuses anything but a Draft rather than soft-deleting more widely
 * and hoping the audit trail survives.
 *
 * 🔑 Soft delete, not a hard one — the run ids a draft claimed are evidence,
 * and `softDelete` keeps the row queryable for anyone reconstructing why a
 * design looked billed on a Tuesday.
 */
export type DeletePaymentSubmissionInput = {
  submission_id: string
  /** When present, the submission must belong to this partner. */
  expected_partner_id?: string
}

const validateSubmissionForDeleteStep = createStep(
  "validate-submission-for-delete",
  async (input: DeletePaymentSubmissionInput, { container }) => {
    const service: PaymentSubmissionsService = container.resolve(
      PAYMENT_SUBMISSIONS_MODULE
    )

    const [submission] = await service.listPaymentSubmissions(
      { id: [input.submission_id] },
      { relations: ["items"] }
    )

    if (!submission) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Payment submission not found: ${input.submission_id}`
      )
    }

    if (
      input.expected_partner_id &&
      submission.partner_id !== input.expected_partner_id
    ) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "You do not have access to this submission"
      )
    }

    if (String(submission.status) !== "Draft") {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `A ${submission.status} submission cannot be deleted. Only a Draft can be — a Pending claim is reviewed, and an Approved or Paid one is the record of money that moved.`
      )
    }

    return new StepResponse(submission)
  }
)

const softDeleteSubmissionStep = createStep(
  "soft-delete-payment-submission",
  async (input: { submission_id: string }, { container }) => {
    const service: PaymentSubmissionsService = container.resolve(
      PAYMENT_SUBMISSIONS_MODULE
    )

    /**
     * The lines go first and explicitly. A submission's items are what every
     * claim guard reads — `listPaymentSubmissionItems` joined to its submission
     * — so a deleted header whose lines survive would keep blocking the designs
     * and runs it named, which is the exact failure this route exists to end.
     */
    const items = (await service.listPaymentSubmissionItems({
      submission_id: [input.submission_id],
    })) as any[]

    const itemIds = (items || []).map((i) => String(i.id))
    if (itemIds.length) {
      await service.softDeletePaymentSubmissionItems(itemIds)
    }

    await service.softDeletePaymentSubmissions([input.submission_id])

    return new StepResponse(undefined, {
      submission_id: input.submission_id,
      item_ids: itemIds,
    })
  },
  async (rollback: any, { container }) => {
    if (!rollback) return
    const service: PaymentSubmissionsService = container.resolve(
      PAYMENT_SUBMISSIONS_MODULE
    )
    await service.restorePaymentSubmissions([rollback.submission_id])
    if (rollback.item_ids?.length) {
      await service.restorePaymentSubmissionItems(rollback.item_ids)
    }
  }
)

export const deletePaymentSubmissionWorkflow = createWorkflow(
  "delete-payment-submission",
  (input: DeletePaymentSubmissionInput) => {
    const submission = validateSubmissionForDeleteStep(input)

    softDeleteSubmissionStep({ submission_id: input.submission_id })

    return new WorkflowResponse({
      id: input.submission_id,
      deleted: true,
      submission,
    })
  }
)
