/**
 * @route GET /admin/payments/partners/:id/ledger
 * @scope admin
 *
 * Everything this partner has been paid or is owed, from BOTH records (#1612).
 *
 * 🔴 There are two, and no surface showed both. Since #1638 a payout is a
 * payment SUBMISSION and approval writes no `internal_payments` row at all,
 * while the 31 rows written before that exist only as `internal_payments`. The
 * partner page rendered a panel per record, so the one labelled "Payments"
 * quietly turned into a history list that a reader had no way to know was
 * partial — the #1621 shape.
 *
 * ⚠️ The two are joined through the RECONCILIATION, never through a link.
 * `defineLink(paymentSubmission, internalPayments)` exists in `src/links`, but
 * its generated table name is 73 characters — past PostgreSQL's 63-byte
 * identifier limit — so the table was never created, in either environment,
 * with no error raised. `query.graph` therefore returns submissions with no
 * `payments` key at all. `payment_reconciliation.payment_id` resolves the 5
 * historical submission-derived rows and is correctly null for everything
 * since.
 *
 * Response: { entries, totals, count }
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import PartnerPaymentsLink from "../../../../../../links/partner-payments-link"
import { PAYMENT_REPORTS_MODULE } from "../../../../../../modules/payment_reports"
import { PAYMENT_SUBMISSIONS_MODULE } from "../../../../../../modules/payment_submissions"
import type PaymentSubmissionsService from "../../../../../../modules/payment_submissions/service"
import { foldPartnerLedger } from "./fold"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id: partner_id } = req.params

  const submissionsService: PaymentSubmissionsService = req.scope.resolve(
    PAYMENT_SUBMISSIONS_MODULE
  )

  const submissions = (await submissionsService.listPaymentSubmissions({
    partner_id,
  })) as any[]

  const submissionIds = submissions.map((s) => s.id)

  const items = submissionIds.length
    ? ((await submissionsService.listPaymentSubmissionItems({
        submission_id: submissionIds,
      })) as any[])
    : []

  /**
   * The partner's `internal_payments`. Best-effort: a partner with no link rows
   * at all is the normal case for anyone onboarded after #1638, and a graph
   * hiccup must not turn a panel that CAN answer the payout question into an
   * error.
   */
  let payments: any[] = []
  try {
    const query: any = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: PartnerPaymentsLink.entryPoint,
      fields: [
        "internal_payments.*",
        "internal_payments.paid_to.*",
        "internal_payments.attachments.*",
      ],
      filters: { partner_id },
    })
    payments = (data || []).map((r: any) => r.internal_payments).filter(Boolean)
  } catch {
    payments = []
  }

  /**
   * The reconciliations for THESE submissions.
   *
   * ⚠️ Scoped by `reference_id`, deliberately not by `partner_id`. The column
   * exists on the model but nothing guarantees the 5 historical rows carry it,
   * and a filter on a field that is null on the very rows it must find would
   * silently return none — leaving each of those payouts rendered beside a
   * second entry for the same money.
   */
  let reconciliations: any[] = []
  if (submissionIds.length) {
    try {
      const reportsService: any = req.scope.resolve(PAYMENT_REPORTS_MODULE)
      reconciliations = (await reportsService.listPaymentReconciliations({
        reference_type: "payment_submission",
        reference_id: submissionIds,
      })) as any[]
    } catch {
      reconciliations = []
    }
  }

  const { entries, totals } = foldPartnerLedger({
    submissions,
    items,
    payments,
    reconciliations,
  })

  return res.status(200).json({ entries, totals, count: entries.length })
}
