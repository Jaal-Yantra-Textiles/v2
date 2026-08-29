import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
  transform,
  when,
} from "@medusajs/framework/workflows-sdk"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import type { IEventBusModuleService } from "@medusajs/types"
import { PAYMENT_REPORTS_MODULE } from "../../modules/payment_reports"
import { PAYMENT_SUBMISSIONS_MODULE } from "../../modules/payment_submissions"
import { INTERNAL_PAYMENTS_MODULE } from "../../modules/internal_payments"
import Payment_reportsService from "../../modules/payment_reports/service"
import PaymentSubmissionsService from "../../modules/payment_submissions/service"
import InternalPaymentService from "../../modules/internal_payments/service"
import SubmissionPaidToMethodLink from "../../links/submission-paid-to-method-link"

export type SettlePaymentReconciliationInput = {
  reconciliation_id: string
  settled_by: string
  notes?: string
}

/**
 * Settling is the moment money is recorded as having MOVED.
 *
 * 🔴 This is the only such moment in the system, and it is the one prod
 * actually performs: 5 of 5 reconciliations carry a real `settled_at`, by the
 * same admin, while the `internal_payments` row approval used to create was
 * left `Pending` 5 times out of 5. Approval no longer claims `Paid` (#1639);
 * this does.
 */
const settleReconciliationStep = createStep(
  "settle-reconciliation",
  async (input: SettlePaymentReconciliationInput, { container }) => {
    const service: Payment_reportsService = container.resolve(
      PAYMENT_REPORTS_MODULE
    )

    const [existing] = await service.listPaymentReconciliations({
      id: [input.reconciliation_id],
    })
    if (!existing) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Reconciliation record not found: ${input.reconciliation_id}`
      )
    }
    if (existing.status === "Settled") {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "This reconciliation is already settled"
      )
    }

    /**
     * A `Discrepant` record settles like any other, deliberately. Discrepant
     * means expected and actual disagree and BOTH are known — settling records
     * that `actual_amount` was sent, which is exactly the fact being captured.
     * Writing a payout off without sending it is `Waived`, a different value.
     */
    const settledAt = new Date()

    const updateData: Record<string, any> = {
      id: input.reconciliation_id,
      status: "Settled",
      settled_at: settledAt,
      settled_by: input.settled_by,
    }
    if (input.notes) {
      updateData.notes = input.notes
    }

    const updated = await service.updatePaymentReconciliations(updateData)

    return new StepResponse(
      {
        reconciliation: updated,
        settled_at: settledAt,
        reference_type: existing.reference_type as string,
        reference_id: (existing.reference_id as string) || null,
        partner_id: (existing.partner_id as string) || null,
        actual_amount: existing.actual_amount,
      },
      {
        id: input.reconciliation_id,
        previous_status: existing.status,
        previous_settled_at: existing.settled_at,
        previous_settled_by: existing.settled_by,
        previous_notes: existing.notes,
      }
    )
  },
  async (rollback: any, { container }) => {
    if (!rollback) return
    const service: Payment_reportsService = container.resolve(
      PAYMENT_REPORTS_MODULE
    )
    await service.updatePaymentReconciliations({
      id: rollback.id,
      status: rollback.previous_status,
      settled_at: rollback.previous_settled_at,
      settled_by: rollback.previous_settled_by,
      notes: rollback.previous_notes,
    })
  }
)

/**
 * Carry the same fact onto the submission, so the two records cannot disagree.
 *
 * The submission is the payout record (#1636); reconciliation is where the
 * settle action already lives and is already used. Rather than ask for a second
 * click, one action writes both.
 */
const markSubmissionPaidOnSettleStep = createStep(
  "mark-submission-paid-on-settle",
  async (
    input: { submission_id: string; paid_at: Date },
    { container }
  ) => {
    const service: PaymentSubmissionsService = container.resolve(
      PAYMENT_SUBMISSIONS_MODULE
    )

    const [prev] = await service.listPaymentSubmissions({
      id: [input.submission_id],
    })
    if (!prev) {
      // A reconciliation may reference a submission that no longer exists;
      // that must not block recording that the money moved.
      return new StepResponse<{ skipped: true } | null>({ skipped: true }, null)
    }

    await service.updatePaymentSubmissions({
      id: input.submission_id,
      status: "Paid",
      paid_at: input.paid_at,
    })

    return new StepResponse<{ skipped: true } | null>(null, {
      submission_id: input.submission_id,
      previous_status: prev.status,
      previous_paid_at: prev.paid_at,
    } as any)
  },
  async (rollback: any, { container }) => {
    if (!rollback) return
    const service: PaymentSubmissionsService = container.resolve(
      PAYMENT_SUBMISSIONS_MODULE
    )
    await service.updatePaymentSubmissions({
      id: rollback.submission_id,
      status: rollback.previous_status,
      paid_at: rollback.previous_paid_at,
    })
  }
)

/**
 * Tell the partner they have been paid — now that they have been.
 *
 * The event name and payload are unchanged, so the seeded WhatsApp flow
 * (`payment_submission.paid` → `jyt_payment_submission_paid_v1`) keeps working;
 * only its timing moves. `payment_type` is read from the METHOD the payout was
 * linked to at approval, spelled in the legacy enum subscribers expect.
 */
const emitSubmissionPaidStep = createStep(
  "emit-submission-paid-on-settle",
  async (
    input: { submission_id: string; partner_id: string | null },
    { container }
  ) => {
    const submissionService: PaymentSubmissionsService = container.resolve(
      PAYMENT_SUBMISSIONS_MODULE
    )
    const [submission] = await submissionService.listPaymentSubmissions({
      id: [input.submission_id],
    })
    if (!submission) {
      return new StepResponse({ emitted: false })
    }

    let paymentType: string | null = null
    try {
      const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
      const { data } = await query.graph({
        entity: SubmissionPaidToMethodLink.entryPoint,
        fields: ["internal_payment_details_id"],
        filters: { payment_submission_id: input.submission_id },
      })
      const methodId = (data || [])[0]?.internal_payment_details_id
      if (methodId) {
        const paymentService: InternalPaymentService = container.resolve(
          INTERNAL_PAYMENTS_MODULE
        )
        const [method] = (await paymentService.listPaymentDetails({
          id: [methodId],
        })) as any[]
        const map: Record<string, string> = {
          bank_account: "Bank",
          cash_account: "Cash",
          digital_wallet: "Digital_Wallet",
        }
        paymentType = map[method?.type] ?? null
      }
    } catch {
      // A payout settled without a resolvable method is still a settled payout.
      paymentType = null
    }

    const eventService = container.resolve(
      Modules.EVENT_BUS
    ) as IEventBusModuleService

    await eventService.emit([
      {
        name: "payment_submission.paid",
        data: {
          payment_submission_id: input.submission_id,
          partner_id: input.partner_id ?? submission.partner_id,
          total_amount: submission.total_amount,
          currency: submission.currency,
          rejection_reason: null,
          payment_type: paymentType,
          payment_id: null,
        },
      },
    ])

    return new StepResponse({ emitted: true })
  }
)

export const settlePaymentReconciliationWorkflow = createWorkflow(
  "settle-payment-reconciliation",
  (input: SettlePaymentReconciliationInput) => {
    const settled = settleReconciliationStep(input)

    const submissionId = transform({ settled }, (d) =>
      d.settled.reference_type === "payment_submission" && d.settled.reference_id
        ? String(d.settled.reference_id)
        : ""
    )
    const hasSubmission = transform(
      { submissionId },
      (d) => Boolean(d.submissionId)
    )

    when(hasSubmission, (v) => v).then(() =>
      markSubmissionPaidOnSettleStep({
        submission_id: submissionId,
        paid_at: settled.settled_at,
      })
    )

    when(hasSubmission, (v) => v).then(() =>
      emitSubmissionPaidStep({
        submission_id: submissionId,
        partner_id: settled.partner_id,
      })
    )

    return new WorkflowResponse({ reconciliation: settled.reconciliation })
  }
)
