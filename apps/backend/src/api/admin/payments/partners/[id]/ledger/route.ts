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
 * 🔴 CORRECTED (#1710) — this route used to say the two could only be joined
 * through the RECONCILIATION, because `defineLink(paymentSubmission,
 * internalPayments)` generates a 73-character table name and "the table was
 * never created, in either environment, with no error raised". That is wrong.
 * Medusa abbreviates each segment of an over-long link name to four characters
 * and appends a hash, and the table exists and is migrated in both:
 *
 *     paym_subm_paym_subm_inte_paym_inte_paym-9812b09f
 *
 * `query.graph` returned no `payments` key because the table held ZERO ROWS.
 * Nothing wrote it — a capability declared dead on a mechanism that was never
 * the mechanism. `linkPaymentToSubmissionsStep` writes it now.
 *
 * ## Where a partner's payments are read from (#1710)
 *
 * THREE homes, unioned and deduped by payment id — because one payment may sit
 * in any of them and a reader that knows only one reports the others as zero:
 *
 *   1. the PARTNER link          — how a payment recorded on the partner arrives
 *   2. the INVENTORY ORDER link  — how `POST /partners/inventory-orders/:id/
 *                                  submit-payment` records one. Two Completed
 *                                  INR 10,000 payments lived only here, so the
 *                                  ledger said `recorded: 0` while the order
 *                                  page said `recorded: 20000`.
 *   3. the SUBMISSION link       — a payment that names the payout it settles.
 *
 * ⚠️ Reading by order needs no backfill, which is why it is a read-side union
 * rather than a data migration: every historical row is covered the moment this
 * ships, and nothing has to be rewritten to be seen.
 *
 * Response: { entries, totals, count }
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import PartnerPaymentsLink from "../../../../../../links/partner-payments-link"
import { PAYMENT_REPORTS_MODULE } from "../../../../../../modules/payment_reports"
import { PAYMENT_SUBMISSIONS_MODULE } from "../../../../../../modules/payment_submissions"
import type PaymentSubmissionsService from "../../../../../../modules/payment_submissions/service"
import { foldPartnerLedger, mergePaymentSources } from "./fold"

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
   * The partner's `internal_payments`, from every home they can live in.
   *
   * Each pass is best-effort: a partner with no link rows of a given kind is
   * the normal case, and a graph hiccup on one source must not turn a panel
   * that CAN answer the payout question into an error. Losing one source
   * understates `recorded`; throwing loses the whole ledger.
   */
  const query: any = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  /**
   * The three homes, collected here and unioned by `mergePaymentSources` below.
   * The partner source is listed FIRST so a payment recorded on the partner
   * keeps that provenance; the order and submission sources only fill in
   * `inventory_order_id` / `submission_id` on a row already present.
   */
  const sources: Array<{ rows: any[]; attribution?: Record<string, any> }> = []

  // ── 1. through the PARTNER link ──────────────────────────────────────────
  try {
    const { data } = await query.graph({
      entity: PartnerPaymentsLink.entryPoint,
      fields: [
        "internal_payments.*",
        "internal_payments.paid_to.*",
        "internal_payments.attachments.*",
      ],
      filters: { partner_id },
    })
    sources.push({
      rows: (data || []).map((r: any) => r?.internal_payments).filter(Boolean),
    })
  } catch {
    // A graph hiccup must not turn a panel that CAN answer the payout question
    // into an error.
  }

  /**
   * ⚠️ The order's display name comes from the submission ITEMS, not from the
   * order: `inventory_orders` has no name or number column at all. A field the
   * query cannot fetch would have read `null` forever without erroring.
   */
  const orderNames = new Map<string, string>()
  for (const item of items) {
    if (item.inventory_order_id && item.inventory_order_name) {
      orderNames.set(String(item.inventory_order_id), item.inventory_order_name)
    }
  }

  /**
   * ── 2. through the INVENTORY ORDER link ────────────────────────────────
   *
   * 🔴 The #1710 defect. Scoped to the orders this PARTNER owns — reached
   * through the partner, since `inventory_orders` has no partner column.
   *
   * ⚠️ `partner.inventory_orders` is a LIST link, so the orders arrive nested,
   * and `internal_payments` on each is itself a to-many that can arrive as a
   * bare object rather than an array when a single row matches.
   */
  try {
    const { data } = await query.graph({
      entity: "partner",
      fields: [
        "id",
        "inventory_orders.id",
        "inventory_orders.internal_payments.*",
        "inventory_orders.internal_payments.paid_to.*",
        "inventory_orders.internal_payments.attachments.*",
      ],
      filters: { id: partner_id },
    })
    const orders = ((data || [])[0]?.inventory_orders || []) as any[]
    for (const order of Array.isArray(orders) ? orders : [orders]) {
      if (!order?.id) continue
      const raw = order.internal_payments
      const rows = !raw ? [] : Array.isArray(raw) ? raw : [raw]
      sources.push({
        rows: rows.filter(Boolean),
        attribution: {
          inventory_order_id: String(order.id),
          inventory_order_name: orderNames.get(String(order.id)) ?? null,
        },
      })
    }
  } catch {
    // Same reason as above: an incomplete panel beats a broken one.
  }

  /**
   * ── 3. through the SUBMISSION link ─────────────────────────────────────
   *
   * The payout a payment explicitly settles. Empty until
   * `linkPaymentToSubmissionsStep` has run for a payment, which is the point:
   * it is the fact a human states, not one this route infers.
   */
  if (submissionIds.length) {
    try {
      const { data } = await query.graph({
        entity: "payment_submission",
        fields: [
          "id",
          "payments.*",
          "payments.paid_to.*",
          "payments.attachments.*",
        ],
        filters: { id: submissionIds },
      })
      for (const sub of (data || []) as any[]) {
        const raw = sub?.payments
        const rows = !raw ? [] : Array.isArray(raw) ? raw : [raw]
        sources.push({
          rows: rows.filter(Boolean),
          attribution: { submission_id: String(sub.id) },
        })
      }
    } catch {
      // The link may not be traversable in every environment; the other two
      // homes still answer.
    }
  }

  const payments = mergePaymentSources(sources)

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
