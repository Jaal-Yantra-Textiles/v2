/**
 * @route POST /admin/partners/:id/credits/:creditId/apply
 * @scope admin
 *
 * Consume a credit against a specific payout (#1712).
 *
 * 🔑 This is the deliberate act the model was built around. `status` starts
 * `Open` and is DISPLAYED, never subtracted, because whether money already
 * given discharges the next payout is a decision a human makes — the same rule
 * `recorded_against_open` follows. This route is where that human makes it.
 *
 * A credit records money the partner already holds from an EARLIER payment.
 * Splitting one payment across several payouts is a different act — the fold
 * allocates it (#1712) and the admin can name each share (#2523) — and the
 * settled figure this route checks comes from that same fold, so a shared
 * payment is never counted in full against each payout.
 *
 * Forward-only. There is no unapply: reversing a settled money decision is a
 * new decision with its own reason, and it belongs in a credit of its own
 * rather than in a silent rollback of this one.
 *
 * Response: { credit, submission_id, remaining_before, remaining_after }
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"

import PartnerCreditLink from "../../../../../../../links/partner-credit-link"
import { INTERNAL_PAYMENTS_MODULE } from "../../../../../../../modules/internal_payments"
import type InternalPaymentService from "../../../../../../../modules/internal_payments/service"
import {
  appliedCreditsFor,
  checkCreditApplicable,
  settledFromLedger,
} from "../../../../../../../modules/internal_payments/lib/apply-credit"
import { PAYMENT_SUBMISSIONS_MODULE } from "../../../../../../../modules/payment_submissions"
import type PaymentSubmissionsService from "../../../../../../../modules/payment_submissions/service"
import { readPartnerLedger } from "../../../../../payments/partners/[id]/ledger/read-ledger"

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const partnerId = String(req.params.id)
  const creditId = String(req.params.creditId)
  const body = (req.validatedBody ?? req.body ?? {}) as any
  const submissionId = String(body.submission_id ?? "").trim()

  if (!submissionId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "submission_id is required — a credit is applied to a specific payout, never to a partner in general"
    )
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any

  /**
   * ⚠️ The credit is looked up THROUGH THE PARTNER LINK, not by id alone.
   *
   * `partner_credit` has no partner column, so fetching by id would happily
   * return another partner's credit and apply it here — the shape that
   * rendered every partner's quote on every storefront. The URL names a
   * partner and the body names a payout; both ends are checked (#1595).
   */
  const { data: creditRows } = await query.graph({
    entity: PartnerCreditLink.entryPoint,
    fields: ["partner_credit.*"],
    filters: { partner_id: partnerId },
  })

  const credits = (creditRows || [])
    .map((row: any) => row?.partner_credit)
    .filter(Boolean)

  const credit = credits.find((c: any) => String(c?.id) === creditId)
  if (!credit) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `credit ${creditId} does not belong to partner ${partnerId}`
    )
  }

  const submissionsService: PaymentSubmissionsService = req.scope.resolve(
    PAYMENT_SUBMISSIONS_MODULE
  )

  /**
   * Same rule for the other end: filtered by partner AND id, so a payout that
   * belongs to someone else is a 404 rather than a discharge of their claim.
   */
  const submissions = (await submissionsService.listPaymentSubmissions({
    partner_id: partnerId,
    id: submissionId,
  })) as any[]
  const submission = submissions?.[0]
  if (!submission) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `payout ${submissionId} does not belong to partner ${partnerId}`
    )
  }

  /**
   * What has already settled against this payout, by the SAME rule the ledger
   * uses: only `Completed` payments a human LINKED to it.
   *
   * ⚠️ `Pending` is excluded on purpose. It is the status the partner portal
   * writes on a payment a partner records themselves, so counting it would let
   * a partner shrink the headroom this route checks — and thereby block a
   * credit — by asserting they had been paid.
   *
   * 🔑 Read off the FOLDED ledger, not by summing linked payments (#2523). A
   * payment split across several payouts would count in full against each.
   *
   * Not best-effort: a missing figure here would read as 0 settled, which
   * WIDENS the headroom and lets a credit discharge money already paid. If the
   * ledger cannot be read, the application is refused by the throw.
   */
  const ledger = await readPartnerLedger(req.scope, partnerId)
  const settledAmount = settledFromLedger(ledger.entries as any[], submissionId)

  const already = appliedCreditsFor(submissionId, credits)

  const verdict = checkCreditApplicable({
    credit,
    submission,
    settledAmount,
    appliedCreditsTotal: already.total,
  })

  if (!verdict.ok) {
    /**
     * 🔑 The refusal names both numbers. "Cannot apply" with no figures is the
     * shape that sends an operator to the database to find out why, and the
     * shape that gets worked around by editing rows directly.
     */
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      verdict.refusal.message
    )
  }

  const service: InternalPaymentService = req.scope.resolve(
    INTERNAL_PAYMENTS_MODULE
  )

  /**
   * The three fields move TOGETHER. A credit marked `Applied` without
   * `applied_to_submission_id` is an enum value with no writer of its own
   * meaning — the shape that left one payout carrying three statuses and none
   * of them joined to the order.
   */
  const appliedAt = new Date()
  const updated = await (service as any).updatePartnerCredits({
    id: creditId,
    status: "Applied",
    applied_to_submission_id: submissionId,
    applied_at: appliedAt,
  })

  return res.status(200).json({
    credit: Array.isArray(updated) ? updated[0] : updated,
    submission_id: submissionId,
    remaining_before: verdict.remaining_before,
    remaining_after: verdict.remaining_after,
  })
}
