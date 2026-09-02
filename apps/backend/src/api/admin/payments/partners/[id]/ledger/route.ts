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

import PartnerCreditLink from "../../../../../../links/partner-credit-link"
import PartnerPaymentsLink from "../../../../../../links/partner-payments-link"
import SubmissionPaymentLink from "../../../../../../links/submission-payment-link"
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
   * ── 2b. the SAME orders, reached in ONE hop ──────────────────────────────
   *
   * 🔴 Belt and braces, and not paranoia. 2a traverses
   * `partner → inventory_orders → internal_payments` — TWO link hops across
   * three modules — and that resolved nothing in the integration environment
   * while working on production. A traversal that returns no rows is
   * indistinguishable from an order with no payments, so the failure is silent
   * and the panel reports INR 0 recorded: the exact defect this route exists to
   * fix, reintroduced by the query shape used to fix it.
   *
   * This is the query `/admin/inventory-orders/:id/payments` has always used —
   * `inventory_orders` filtered by id, ONE hop to `internal_payments` — over
   * the orders the submission LINES name. Those are precisely the orders a
   * payout bills, so it covers every case that can raise a double-pay warning.
   *
   * ⚠️ It does NOT replace 2a: an order with no payout names no line, so only
   * the partner traversal can find money sitting on it (Parmar's INR 9,800).
   * The union dedupes by payment id, so running both costs nothing.
   */
  const linedOrderIds = [...orderNames.keys()]
  const claimedOrderIds = Array.from(
    new Set([
      ...linedOrderIds,
      ...items.map((i) => i.inventory_order_id).filter(Boolean).map(String),
    ])
  )

  if (claimedOrderIds.length) {
    try {
      const { data } = await query.graph({
        entity: "inventory_orders",
        fields: [
          "id",
          "internal_payments.*",
          "internal_payments.paid_to.*",
          "internal_payments.attachments.*",
        ],
        filters: { id: claimedOrderIds },
      })
      for (const order of (data || []) as any[]) {
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
      // Same reason again.
    }
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
      /**
       * 🔴 Read through the LINK'S ENTRY POINT, not by traversing from
       * `payment_submission`.
       *
       * `entity: "payment_submission", fields: ["payments.*"]` returns the
       * submissions with NO `payments` key — silently, with no error. Two
       * successful link writes and a 200 from `/settles` still read back as
       * `paid: 0`, which is the same class of silent-absence this whole issue
       * is about, and it is what made the link look unwritable for months.
       *
       * The entry-point form is what source 1 above uses (`PartnerPaymentsLink`)
       * and what every working link read in this codebase uses. Same shape,
       * same direction: filter on one side's id, select the other side.
       */
      const { data } = await query.graph({
        entity: SubmissionPaymentLink.entryPoint,
        fields: [
          "payment_submission_id",
          "internal_payments.*",
          "internal_payments.paid_to.*",
          "internal_payments.attachments.*",
        ],
        filters: { payment_submission_id: submissionIds },
      })
      for (const row of (data || []) as any[]) {
        const raw = row?.internal_payments
        const rows = !raw ? [] : Array.isArray(raw) ? raw : [raw]
        sources.push({
          rows: rows.filter(Boolean),
          attribution: { submission_id: String(row.payment_submission_id) },
        })
      }
    } catch {
      // The other two homes still answer.
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

  /**
   * ── The partner's credits (#1712) ───────────────────────────────────────
   *
   * Money already given that no payout consumed. Read here so that a credit a
   * human APPLIED to a payout actually reduces what that payout still claims —
   * without this the fold would compute `credited: 0` forever and the apply
   * route would stamp a decision no screen honoured. A guard reading a field
   * the query never fetched is dead, and this is the query that fetches it.
   *
   * ⚠️ Through the LINK'S ENTRY POINT: `partner_credit` has no partner column.
   *
   * Best-effort, like every other source above. Losing credits understates
   * `credited` and so OVERSTATES `outstanding` — the safe direction: it can
   * make us look at a claim that is already discharged, never hide one.
   */
  let credits: any[] = []
  try {
    const { data } = await query.graph({
      entity: PartnerCreditLink.entryPoint,
      fields: ["partner_credit.*"],
      filters: { partner_id },
    })
    credits = (data || []).map((r: any) => r?.partner_credit).filter(Boolean)
  } catch {
    credits = []
  }

  const { entries, totals } = foldPartnerLedger({
    submissions,
    items,
    payments,
    reconciliations,
    credits,
  })

  return res.status(200).json({ entries, totals, count: entries.length })
}
