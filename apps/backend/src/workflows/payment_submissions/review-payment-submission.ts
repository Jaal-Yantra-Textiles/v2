import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
  when,
  transform,
} from "@medusajs/framework/workflows-sdk"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import { LinkDefinition } from "@medusajs/framework/types"
import type { IEventBusModuleService } from "@medusajs/types"
import type { Link } from "@medusajs/modules-sdk"
import { PAYMENT_SUBMISSIONS_MODULE } from "../../modules/payment_submissions"
import { INTERNAL_PAYMENTS_MODULE } from "../../modules/internal_payments"
import { PAYMENT_REPORTS_MODULE } from "../../modules/payment_reports"
import { PARTNER_MODULE } from "../../modules/partner"
import PaymentSubmissionsService from "../../modules/payment_submissions/service"
import InternalPaymentService from "../../modules/internal_payments/service"
import Payment_reportsService from "../../modules/payment_reports/service"
import PartnerPaymentMethodsLink from "../../links/partner-payment-methods-link"
import { ORDER_INVENTORY_MODULE } from "../../modules/inventory_orders"
import { resolveSubmissionSource } from "./lib/submission-source"

export type ReviewPaymentSubmissionInput = {
  submission_id: string
  action: "approve" | "reject"
  reviewed_by: string
  rejection_reason?: string
  amount_override?: number
  payment_type?: "Bank" | "Cash" | "Digital_Wallet"
  paid_to_id?: string
  notes?: string
}

// Step 1: Validate submission is reviewable
const validateSubmissionForReviewStep = createStep(
  "validate-submission-for-review",
  async (input: { submission_id: string }, { container }) => {
    const service: PaymentSubmissionsService = container.resolve(
      PAYMENT_SUBMISSIONS_MODULE
    )

    const submissions = await service.listPaymentSubmissions(
      { id: [input.submission_id] },
      { relations: ["items"] }
    )

    const submission = submissions[0]
    if (!submission) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Payment submission not found: ${input.submission_id}`
      )
    }

    const REVIEWABLE_STATUSES = ["Pending", "Under_Review"]
    if (!REVIEWABLE_STATUSES.includes(submission.status)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Submission cannot be reviewed in status "${submission.status}". Must be Pending or Under_Review.`
      )
    }

    return new StepResponse(submission)
  }
)

// Step 2: Update submission status
const updateSubmissionStatusStep = createStep(
  "update-submission-status",
  async (
    input: {
      submission_id: string
      action: "approve" | "reject"
      reviewed_by: string
      rejection_reason?: string
      notes?: string
    },
    { container }
  ) => {
    const service: PaymentSubmissionsService = container.resolve(
      PAYMENT_SUBMISSIONS_MODULE
    )

    // Fetch previous state for compensation
    const [prev] = await service.listPaymentSubmissions({
      id: [input.submission_id],
    })

    const updateData: Record<string, any> = {
      id: input.submission_id,
      reviewed_at: new Date(),
      reviewed_by: input.reviewed_by,
    }

    if (input.action === "approve") {
      updateData.status = "Approved"
    } else {
      updateData.status = "Rejected"
      updateData.rejection_reason = input.rejection_reason || null
    }

    if (input.notes) {
      updateData.notes = input.notes
    }

    const updated = await service.updatePaymentSubmissions(updateData)

    return new StepResponse(updated, {
      submission_id: input.submission_id,
      previous_status: prev.status,
      previous_reviewed_at: prev.reviewed_at,
      previous_reviewed_by: prev.reviewed_by,
      previous_rejection_reason: prev.rejection_reason,
    })
  },
  async (rollbackData: any, { container }) => {
    if (!rollbackData) return
    const service: PaymentSubmissionsService = container.resolve(
      PAYMENT_SUBMISSIONS_MODULE
    )
    await service.updatePaymentSubmissions({
      id: rollbackData.submission_id,
      status: rollbackData.previous_status,
      reviewed_at: rollbackData.previous_reviewed_at,
      reviewed_by: rollbackData.previous_reviewed_by,
      rejection_reason: rollbackData.previous_rejection_reason,
    })
  }
)

/**
 * Step 3: resolve the payment METHOD this payout goes to, and record it on the
 * submission itself.
 *
 * 🔴 This step used to call `createPayments` and produce an `internal_payments`
 * row (#1636). It no longer does. One payout used to exist as three records
 * with three different answers to "has this partner been paid" — the submission
 * said Paid, the payment said Pending forever because nothing ever moved it,
 * and reconciliation said Settled. The submission is now the single payout
 * record. Historical `internal_payments` rows are left exactly where they are;
 * this only stops new ones being created.
 *
 * The method is still an `internal_payment_details` row — a payment METHOD, not
 * a payment record — so the dependency that survives is the correct one. It is
 * attached through the `payment_submission_paid_to_method` link rather than a
 * `paid_to_id` column, because the two models live in different modules.
 */
const resolvePaidToMethodStep = createStep(
  "resolve-paid-to-method",
  async (
    input: {
      submission_id: string
      partner_id: string
      paid_to_id?: string
    },
    { container }
  ) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as any

    const { data: linkData } = await query.graph({
      entity: PartnerPaymentMethodsLink.entryPoint,
      fields: ["internal_payment_details_id"],
      filters: { partner_id: input.partner_id },
    })
    const methodIds = ((linkData || []) as any[]).map(
      (r) => r.internal_payment_details_id
    )

    const paymentService: InternalPaymentService = container.resolve(
      INTERNAL_PAYMENTS_MODULE
    )
    const methods = methodIds.length
      ? ((await paymentService.listPaymentDetails({ id: methodIds })) as any[])
      : []

    /**
     * Four branches, in order. The last one REFUSES rather than guessing.
     *
     * 🔴 The old code took `methods[0]` — whichever row the link query happened
     * to return first. In production Sharlho has four bank accounts, one per
     * employee, and three of them have received money at different times; two
     * more partners have two methods each. Taking the first row there does not
     * pay the wrong account, it pays the wrong PERSON. A partner with several
     * methods and no default is a question for the reviewer, not something to
     * resolve by ordering.
     */
    let resolved: any = null

    if (input.paid_to_id) {
      resolved = methods.find((m) => m.id === input.paid_to_id)
      if (!resolved) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Payment method ${input.paid_to_id} is not one of this partner's payment methods.`
        )
      }
    } else if (methods.some((m) => m.is_default)) {
      resolved = methods.find((m) => m.is_default)
    } else if (methods.length === 1) {
      resolved = methods[0]
    } else if (methods.length > 1) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Cannot approve payment: partner has ${methods.length} payment methods and none is marked default. ` +
          `Choose which one to pay, or mark one as the partner's default.`
      )
    }

    if (!resolved) {
      // Kept verbatim — approving a payout to a partner with no bank details
      // approves something that cannot be paid.
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Cannot approve payment: partner has no payment method configured. Ask the partner to add their bank/wallet details first."
      )
    }

    const remoteLink = container.resolve(
      ContainerRegistrationKeys.LINK
    ) as Link

    const link: LinkDefinition = {
      [PAYMENT_SUBMISSIONS_MODULE]: {
        payment_submission_id: input.submission_id,
      },
      [INTERNAL_PAYMENTS_MODULE]: {
        internal_payment_details_id: resolved.id,
      },
    }
    await remoteLink.create([link])

    return new StepResponse(
      {
        id: resolved.id,
        type: resolved.type as string,
        account_name: resolved.account_name as string,
      },
      link
    )
  },
  async (rollbackLink: LinkDefinition, { container }) => {
    if (!rollbackLink) return
    const remoteLink = container.resolve(
      ContainerRegistrationKeys.LINK
    ) as Link
    await remoteLink.dismiss([rollbackLink]).catch(() => {})
  }
)

/**
 * Where this payout's money came from, folded from the submission's LINES.
 *
 * A step of its own so reconciliation and the inventory-order link read the
 * same answer. Derived from the lines rather than accepted from the reviewer:
 * a review action knows nothing about provenance, and a source supplied by the
 * caller could contradict the lines it claims to describe.
 */
const resolveSubmissionSourceStep = createStep(
  "resolve-submission-source",
  async (input: { submission_id: string }, { container }) => {
    const service: PaymentSubmissionsService = container.resolve(
      PAYMENT_SUBMISSIONS_MODULE
    )

    const items = await service.listPaymentSubmissionItems({
      submission_id: input.submission_id,
    })

    return new StepResponse(resolveSubmissionSource(items as any[]))
  }
)

// Step 5: Create reconciliation record
const createReconciliationRecordStep = createStep(
  "create-reconciliation-record",
  async (
    input: {
      submission_id: string
      partner_id: string
      expected_amount: number
      actual_amount: number
      source_type: string | null
      source_id: string | null
    },
    { container }
  ) => {
    const service: Payment_reportsService = container.resolve(
      PAYMENT_REPORTS_MODULE
    )


    const discrepancy = input.actual_amount - input.expected_amount
    const status =
      Math.abs(discrepancy) < 0.01 ? "Matched" : "Discrepant"

    const reconciliation = await service.createPaymentReconciliations({
      // `reference_*` stays the record being reconciled; `source_*` says where
      // the money came from. Two facts, two columns — see the model.
      reference_type: "payment_submission",
      reference_id: input.submission_id,
      source_type: input.source_type,
      source_id: input.source_id,
      partner_id: input.partner_id,
      expected_amount: input.expected_amount,
      actual_amount: input.actual_amount,
      discrepancy,
      status,
      /**
       * 🔴 Vestigial for new payouts (#1636). `payment_id` was the only
       * traversable route from a submission to its payment, and #1634 had just
       * repaired a backfill to use it — but approval no longer creates a
       * payment row, so there is nothing to point at. Nothing is lost:
       * `reference_id` already names the submission, which IS the payout record
       * now. The column still resolves the 5 historical rows.
       */
      payment_id: null,
    })

    return new StepResponse(reconciliation, reconciliation.id)
  },
  async (reconciliationId: string, { container }) => {
    if (!reconciliationId) return
    const service: Payment_reportsService = container.resolve(
      PAYMENT_REPORTS_MODULE
    )
    await service.softDeletePaymentReconciliations(reconciliationId)
  }
)

// Step 6: Mark submission as paid
const markSubmissionPaidStep = createStep(
  "mark-submission-paid",
  async (input: { submission_id: string }, { container }) => {
    const service: PaymentSubmissionsService = container.resolve(
      PAYMENT_SUBMISSIONS_MODULE
    )

    await service.updatePaymentSubmissions({
      id: input.submission_id,
      status: "Paid",
      paid_at: new Date(),
    })

    return new StepResponse(undefined, input.submission_id)
  },
  async (submissionId: string, { container }) => {
    if (!submissionId) return
    const service: PaymentSubmissionsService = container.resolve(
      PAYMENT_SUBMISSIONS_MODULE
    )
    await service.updatePaymentSubmissions({
      id: submissionId,
      status: "Approved",
      paid_at: null,
    })
  }
)

// Emit a payment_submission.* event after a successful status change.
// Decoupled from the status-update step so emission only happens after
// the entire workflow path that produced the new status has succeeded
// — a rollback in any later step skips the event.
//
// Two events of interest in this workflow:
//   - payment_submission.rejected  → action=reject branch
//   - payment_submission.paid      → action=approve branch (after the
//                                    Approved → Paid transition below)
//
// We deliberately don't emit payment_submission.approved here: the
// approve path goes Approved → Paid in the same atomic workflow, so
// `.approved` would be a transient state the partner never observes.
// If a future change holds at Approved (e.g. for human payment review),
// add the event then.
//
// Note: each createStep call must produce a distinct step instance —
// a single step can't be invoked from two different `when()` branches
// in the same workflow ("Step X is already defined in workflow"). So
// the rejected and paid emitters share a small handler factory but
// land as two separate steps with their own ids.
type EmitInput = {
  event_name: string
  submission_id: string
  partner_id: string
  total_amount: number | null
  currency: string | null
  rejection_reason?: string | null
  payment_type?: string | null
  payment_id?: string | null
}
const emitHandler = async (input: EmitInput, { container }: any) => {
  const eventService = container.resolve(
    Modules.EVENT_BUS,
  ) as IEventBusModuleService
  await eventService.emit([
    {
      name: input.event_name,
      data: {
        payment_submission_id: input.submission_id,
        partner_id: input.partner_id,
        total_amount: input.total_amount,
        currency: input.currency,
        rejection_reason: input.rejection_reason ?? null,
        payment_type: input.payment_type ?? null,
        payment_id: input.payment_id ?? null,
      },
    },
  ])
  return new StepResponse({ emitted: true })
}
const emitPaidEventStep = createStep("emit-payment-submission-paid", emitHandler)
const emitRejectedEventStep = createStep("emit-payment-submission-rejected", emitHandler)

// Workflow
export const reviewPaymentSubmissionWorkflow = createWorkflow(
  "review-payment-submission",
  (input: ReviewPaymentSubmissionInput) => {
    const submission = validateSubmissionForReviewStep({
      submission_id: input.submission_id,
    })

    updateSubmissionStatusStep({
      submission_id: input.submission_id,
      action: input.action,
      reviewed_by: input.reviewed_by,
      rejection_reason: input.rejection_reason,
      notes: input.notes,
    })

    const paymentAmount = transform(
      { submission, input },
      (data) => {
        const base = Number(data.submission.total_amount || 0)
        return data.input.amount_override ?? base
      }
    )

    const isApproval = transform(input, (i) => i.action === "approve")

    const paidToMethod = when(isApproval, (val) => val).then(() =>
      resolvePaidToMethodStep({
        submission_id: input.submission_id,
        partner_id: submission.partner_id,
        paid_to_id: input.paid_to_id,
      })
    )

    const source = when(isApproval, (val) => val).then(() =>
      resolveSubmissionSourceStep({ submission_id: input.submission_id })
    )

    when(isApproval, (val) => val).then(() =>
      createReconciliationRecordStep({
        submission_id: input.submission_id,
        partner_id: submission.partner_id,
        expected_amount: submission.total_amount,
        actual_amount: paymentAmount,
        source_type: source!.source_type,
        source_id: source!.source_id,
      })
    )

    /**
     * ⚠️ The payment → inventory-order link is deliberately gone (#1636).
     *
     * It was wired so an inventory order could show the payout it paid for, but
     * it drew its edge from the `internal_payments` row that approval no longer
     * creates. Nothing regresses: #1625 made payouts reachable from the order
     * through the submission's LINES, which is why GOF's order already showed
     * its ₹30,000 with no such link present. `links/inventory-orders-internal-
     * payments.ts` stays declared for the historical rows.
     */

    when(isApproval, (val) => val).then(() =>
      markSubmissionPaidStep({
        submission_id: input.submission_id,
      })
    )

    /**
     * The payout's type now comes from the METHOD it was paid to rather than
     * from a reviewer-supplied field, so the two can no longer disagree. The
     * event keeps the legacy `Bank`/`Cash`/`Digital_Wallet` spelling because
     * subscribers already read it; `internal_payment_details.type` spells the
     * same three values differently.
     */
    const paidPaymentType = transform({ paidToMethod }, (data) => {
      const map: Record<string, string> = {
        bank_account: "Bank",
        cash_account: "Cash",
        digital_wallet: "Digital_Wallet",
      }
      return map[data.paidToMethod?.type as string] ?? "Bank"
    })

    // Approval branch: now in Paid status — fire the event so the
    // payment-status visual flow can WhatsApp the partner.
    when(isApproval, (val) => val).then(() =>
      emitPaidEventStep({
        event_name: "payment_submission.paid",
        submission_id: input.submission_id,
        partner_id: submission.partner_id,
        total_amount: paymentAmount,
        currency: submission.currency,
        payment_type: paidPaymentType,
        // No payment row is created any more (#1636); the submission is the
        // payout record. Left in the payload rather than removed so existing
        // subscribers keep their shape.
        payment_id: null,
      })
    )

    // Rejection branch: status is now Rejected. Fire the event so the
    // partner gets notified with the reason.
    const isRejection = transform(input, (i) => i.action === "reject")
    when(isRejection, (val) => val).then(() =>
      emitRejectedEventStep({
        event_name: "payment_submission.rejected",
        submission_id: input.submission_id,
        partner_id: submission.partner_id,
        total_amount: submission.total_amount,
        currency: submission.currency,
        rejection_reason: input.rejection_reason ?? null,
      })
    )

    return new WorkflowResponse({ submission, paid_to: paidToMethod })
  }
)
