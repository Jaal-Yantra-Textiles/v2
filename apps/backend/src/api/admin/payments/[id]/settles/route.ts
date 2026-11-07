import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"
import type { Link } from "@medusajs/modules-sdk"

import InventoryOrdersInternalPaymentsLink from "../../../../../links/inventory-orders-internal-payments"
import PartnerInventoryOrderLink from "../../../../../links/partner-inventory-order"
import PartnerPaymentMethodsLink from "../../../../../links/partner-payment-methods-link"
import PartnerPaymentsLink from "../../../../../links/partner-payments-link"
import { INTERNAL_PAYMENTS_MODULE } from "../../../../../modules/internal_payments"
import { PAYMENT_SUBMISSIONS_MODULE } from "../../../../../modules/payment_submissions"
import type PaymentSubmissionsService from "../../../../../modules/payment_submissions/service"
import type InternalPaymentService from "../../../../../modules/internal_payments/service"
import { checkAllocation } from "../../../../../modules/internal_payments/lib/allocation"
import { decideSamePartner, resolvePaymentOwners } from "./same-partner"

/**
 * POST /admin/payments/:id/settles   { payment_submission_id, amount? }
 * DELETE /admin/payments/:id/settles { payment_submission_id }
 *
 * State that an EXISTING payment discharges a payout — or take it back.
 *
 * ## Why this exists (#1710)
 *
 * `paymentSubmissionIds` on `POST /admin/payments/link` only writes the link at
 * CREATION. Every payment already in the system — including the two INR 10,000
 * rows that opened #1710, made months before the payout they pay off — had no
 * way to say what they settle. A capability reachable only for rows that do not
 * exist yet is a capability nobody has (#1612's lesson).
 *
 * ## Why it is a deliberate action and not an inference
 *
 * 🔴 The ledger will NOT decide this on its own, and that is the whole design.
 * A payment sitting on the same inventory order as a payout may be an advance,
 * a deposit, or money for a different delivery — Parmar's other order carries
 * INR 9,800 with no payout in existence at all. So the ledger WARNS
 * (`recorded_against_open`) and refuses to net. This route is where a human
 * turns that warning into a fact, after which the money counts toward `paid`
 * and the payout can be settled in PART.
 *
 * ⚠️ Linking does not change the payment's own `status`. A `Pending` payment
 * that is linked still reports as not-yet-moved, and `foldPartnerLedger`
 * excludes `Failed`/`Cancelled` from settlement entirely. Saying which payout a
 * payment belongs to is a different assertion from saying the money left.
 */
const resolveBoth = async (
  req: MedusaRequest,
  submissionId: string
): Promise<{ payment: any; submission: any }> => {
  if (!submissionId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "payment_submission_id is required"
    )
  }

  /**
   * 🔴 BOTH ends validated, not just the one in the URL. A request that names
   * two ids and checks one is the shape that let body ids through unexamined
   * (#778) — and here the unchecked id decides whose money is discharged.
   */
  const paymentService: InternalPaymentService = req.scope.resolve(
    INTERNAL_PAYMENTS_MODULE
  )
  const [payment] = (await paymentService.listPayments({
    id: [req.params.id],
  })) as any[]
  if (!payment) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Payment ${req.params.id} not found`
    )
  }

  const submissionService: PaymentSubmissionsService = req.scope.resolve(
    PAYMENT_SUBMISSIONS_MODULE
  )
  const [submission] = (await submissionService.listPaymentSubmissions({
    id: [submissionId],
  })) as any[]
  if (!submission) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Payment submission ${submissionId} not found`
    )
  }

  /**
   * ⚠️ A Rejected payout was never owed, so nothing can settle it. Allowing the
   * link would put money against a claim we refused and make `billed` and
   * `paid` disagree about whether the payout exists at all.
   */
  if (String(submission.status) === "Rejected") {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `Payment submission ${submissionId} was rejected — it is not owed, so no payment can settle it.`
    )
  }

  /**
   * 🔴 BOTH ENDS AGAINST EACH OTHER, not merely both present (#1712).
   *
   * Existence checks alone let partner A's money discharge partner B's payout —
   * this route writes `paid` on the partner ledger, so that mistake pays the
   * wrong person and leaves a link nobody would think to question. A bulk
   * reconciliation pass is exactly where an id gets typed one character wrong.
   *
   * Permissive when the payment has no traceable owner — see `same-partner.ts`
   * for why that is deliberate rather than an oversight.
   */
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any
  const owners = await resolvePaymentOwners(
    query,
    {
      partnerPayments: PartnerPaymentsLink,
      orderPayments: InventoryOrdersInternalPaymentsLink,
      partnerOrders: PartnerInventoryOrderLink,
      partnerMethods: PartnerPaymentMethodsLink,
    },
    String(req.params.id),
    /**
     * ⚠️ `paid_to` is a `belongsTo`, so an unexpanded `listPayments` returns the
     * FK column and NOT the object. Reading only `.paid_to.id` would leave home
     * 3 permanently unreached — a check that never runs reads as a pass.
     */
    (payment as any)?.paid_to?.id ?? (payment as any)?.paid_to_id ?? null
  )

  const decision = decideSamePartner(owners, (submission as any)?.partner_id)
  if (!decision.allowed) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `Payment ${req.params.id} belongs to partner ${decision.owners.join(
        ", "
      )}, but submission ${submissionId} belongs to partner ${
        (submission as any).partner_id
      }. A payment cannot settle another partner's payout.`
    )
  }

  return { payment, submission }
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const submissionId = String(
    (req.validatedBody as any)?.payment_submission_id ??
      (req.body as any)?.payment_submission_id ??
      ""
  ).trim()

  const { payment, submission } = await resolveBoth(req, submissionId)

  /**
   * The share of this payment that goes to THIS payout (#2523). Optional:
   * absent, the fold splits the payment oldest-payout-first as before.
   * Checked BEFORE the link is written, so a refused share writes nothing.
   */
  const rawAmount =
    (req.validatedBody as any)?.amount ?? (req.body as any)?.amount
  const paymentService: InternalPaymentService = req.scope.resolve(
    INTERNAL_PAYMENTS_MODULE
  )
  let existingShare: any = null
  if (rawAmount !== undefined && rawAmount !== null) {
    const amount = Number(rawAmount)
    const shares = (await (paymentService as any).listPaymentAllocations({
      payment_id: req.params.id,
    })) as any[]
    existingShare =
      shares.find((a) => a.payment_submission_id === submissionId) ?? null
    const otherShares = shares
      .filter((a) => a.payment_submission_id !== submissionId)
      .reduce((acc, a) => acc + Number(a.amount ?? 0), 0)

    const verdict = checkAllocation({
      paymentId: String(req.params.id),
      submissionId,
      amount,
      paymentAmount: Number(payment.amount ?? 0),
      otherShares,
      payoutTotal: Number(submission.total_amount ?? 0),
    })
    if (!verdict.ok) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, verdict.message)
    }
  }

  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.LINK) as Link

  /**
   * ⚠️ `link.create` is NOT idempotent here — a repeated call would raise on the
   * composite primary key. Dismiss first so re-stating the same fact is a
   * no-op rather than a 500.
   */
  const definition = {
    [PAYMENT_SUBMISSIONS_MODULE]: { payment_submission_id: submissionId },
    [INTERNAL_PAYMENTS_MODULE]: { internal_payments_id: req.params.id },
  }
  await remoteLink.dismiss(definition).catch(() => undefined)
  await remoteLink.create({
    ...definition,
    data: {
      payment_submission_id: submissionId,
      payment_id: req.params.id,
      linked_with: "payment_submission",
    },
  } as any)

  let allocated: number | null = null
  if (rawAmount !== undefined && rawAmount !== null) {
    allocated = Number(rawAmount)
    if (existingShare) {
      await (paymentService as any).updatePaymentAllocations({
        id: existingShare.id,
        amount: allocated,
      })
    } else {
      await (paymentService as any).createPaymentAllocations({
        payment_id: req.params.id,
        payment_submission_id: submissionId,
        amount: allocated,
      })
    }
  }

  return res.status(200).json({
    payment_id: req.params.id,
    payment_submission_id: submissionId,
    settles: true,
    amount: allocated,
  })
}

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const submissionId = String(
    (req.query as any)?.payment_submission_id ??
      (req.body as any)?.payment_submission_id ??
      ""
  ).trim()

  await resolveBoth(req, submissionId)

  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.LINK) as Link
  await remoteLink.dismiss({
    [PAYMENT_SUBMISSIONS_MODULE]: { payment_submission_id: submissionId },
    [INTERNAL_PAYMENTS_MODULE]: { internal_payments_id: req.params.id },
  })

  /**
   * The named share goes with the link (#2523). Left behind, it would come
   * back to life the day someone re-links the pair without an amount.
   */
  const paymentService: InternalPaymentService = req.scope.resolve(
    INTERNAL_PAYMENTS_MODULE
  )
  const stale = (await (paymentService as any).listPaymentAllocations({
    payment_id: req.params.id,
    payment_submission_id: submissionId,
  })) as any[]
  if (stale.length) {
    await (paymentService as any).softDeletePaymentAllocations(
      stale.map((a) => a.id)
    )
  }

  return res.status(200).json({
    payment_id: req.params.id,
    payment_submission_id: submissionId,
    settles: false,
  })
}
