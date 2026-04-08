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
} from "@medusajs/framework/utils"
import { LinkDefinition } from "@medusajs/framework/types"
import type { Link } from "@medusajs/modules-sdk"
import { PAYMENT_SUBMISSIONS_MODULE } from "../../modules/payment_submissions"
import { INTERNAL_PAYMENTS_MODULE } from "../../modules/internal_payments"
import { PAYMENT_REPORTS_MODULE } from "../../modules/payment_reports"
import { PARTNER_MODULE } from "../../modules/partner"
import PaymentSubmissionsService from "../../modules/payment_submissions/service"
import InternalPaymentService from "../../modules/internal_payments/service"
import Payment_reportsService from "../../modules/payment_reports/service"

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

// Step 3: Create internal payment on approval
const createPaymentOnApprovalStep = createStep(
  "create-payment-on-approval",
  async (
    input: {
      partner_id: string
      amount: number
      payment_type: "Bank" | "Cash" | "Digital_Wallet"
      paid_to_id?: string
    },
    { container }
  ) => {
    const paymentService: InternalPaymentService = container.resolve(
      INTERNAL_PAYMENTS_MODULE
    )

    const paymentData: Record<string, any> = {
      amount: input.amount,
      status: "Pending",
      payment_type: input.payment_type,
      payment_date: new Date(),
    }

    if (input.paid_to_id) {
      paymentData.paid_to_id = input.paid_to_id
    }

    const payment = await paymentService.createPayments(paymentData)

    // Link payment to partner
    const remoteLink = container.resolve(
      ContainerRegistrationKeys.LINK
    ) as Link

    const partnerLink: LinkDefinition = {
      [PARTNER_MODULE]: { partner_id: input.partner_id },
      [INTERNAL_PAYMENTS_MODULE]: {
        internal_payments_id: payment.id,
      },
      data: {
        partner_id: input.partner_id,
        payment_id: payment.id,
        linked_with: "partner",
      },
    }

    await remoteLink.create([partnerLink])

    return new StepResponse(payment, {
      payment_id: payment.id,
      partner_link: partnerLink,
    })
  },
  async (
    rollbackData: { payment_id: string; partner_link: LinkDefinition },
    { container }
  ) => {
    if (!rollbackData) return
    const paymentService: InternalPaymentService = container.resolve(
      INTERNAL_PAYMENTS_MODULE
    )
    await paymentService.softDeletePayments(rollbackData.payment_id)

    const remoteLink = container.resolve(
      ContainerRegistrationKeys.LINK
    ) as Link
    await remoteLink.dismiss([rollbackData.partner_link])
  }
)

// Step 4: Link submission to the created payment
const linkSubmissionToPaymentStep = createStep(
  "link-submission-to-payment",
  async (
    input: { submission_id: string; payment_id: string },
    { container }
  ) => {
    const remoteLink = container.resolve(
      ContainerRegistrationKeys.LINK
    ) as Link

    const link: LinkDefinition = {
      [PAYMENT_SUBMISSIONS_MODULE]: {
        payment_submission_id: input.submission_id,
      },
      [INTERNAL_PAYMENTS_MODULE]: {
        internal_payments_id: input.payment_id,
      },
    }

    await remoteLink.create([link])
    return new StepResponse(link, link)
  },
  async (rollbackLink: LinkDefinition, { container }) => {
    if (!rollbackLink) return
    const remoteLink = container.resolve(
      ContainerRegistrationKeys.LINK
    ) as Link
    await remoteLink.dismiss([rollbackLink])
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
      payment_id: string
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
      reference_type: "payment_submission",
      reference_id: input.submission_id,
      partner_id: input.partner_id,
      expected_amount: input.expected_amount,
      actual_amount: input.actual_amount,
      discrepancy,
      status,
      payment_id: input.payment_id,
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
    })
  }
)

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

    const payment = when(isApproval, (val) => val).then(() =>
      createPaymentOnApprovalStep({
        partner_id: submission.partner_id,
        amount: paymentAmount,
        payment_type: (input.payment_type || "Bank") as "Bank" | "Cash" | "Digital_Wallet",
        paid_to_id: input.paid_to_id,
      })
    )

    when(isApproval, (val) => val).then(() =>
      linkSubmissionToPaymentStep({
        submission_id: input.submission_id,
        payment_id: payment!.id,
      })
    )

    when(isApproval, (val) => val).then(() =>
      createReconciliationRecordStep({
        submission_id: input.submission_id,
        partner_id: submission.partner_id,
        expected_amount: submission.total_amount,
        actual_amount: paymentAmount,
        payment_id: payment!.id,
      })
    )

    when(isApproval, (val) => val).then(() =>
      markSubmissionPaidStep({
        submission_id: input.submission_id,
      })
    )

    return new WorkflowResponse({ submission, payment })
  }
)
