/**
 * Fold everything a partner has been paid, or is owed, into ONE ledger (#1612).
 *
 * 🔴 There are two records of money for a partner and there is no longer a
 * surface that shows both. Since #1638 approval no longer writes an
 * `internal_payments` row, so a payout lives only as a payment SUBMISSION,
 * while the 31 historical rows written before that live only as
 * `internal_payments`. The partner page rendered them as two adjacent panels,
 * which meant the "Payments" panel silently became a history list — the #1621
 * shape, where a surface that can no longer see the current data reads as
 * *there is none* rather than *I cannot see it*.
 *
 * The two sources are NOT migrated into one another: the historical rows stay
 * as they are (founder's call). They are interleaved, and every entry says
 * which kind it is.
 *
 * PURE, so the arithmetic that answers "have we settled with them" can be
 * tested without a database behind it.
 */

import { appliedCreditsFor } from "../../../../../../modules/internal_payments/lib/apply-credit"

export type CreditLike = {
  id?: string
  amount?: number | string | null
  status?: string | null
  currency_code?: string | null
  reason?: string | null
  applied_to_submission_id?: string | null
  applied_at?: string | Date | null
}

export type SubmissionLike = {
  id: string
  status?: string | null
  total_amount?: number | string | null
  currency?: string | null
  submitted_at?: string | Date | null
  reviewed_at?: string | Date | null
  paid_at?: string | Date | null
  created_at?: string | Date | null
  notes?: string | null
}

export type SubmissionItemLike = {
  id: string
  submission_id?: string | null
  source_type?: string | null
  design_id?: string | null
  design_name?: string | null
  task_id?: string | null
  task_name?: string | null
  inventory_order_id?: string | null
  inventory_order_name?: string | null
  order_id?: string | null
  production_run_ids?: string[] | null
}

export type PaymentLike = {
  id: string
  amount?: number | string | null
  status?: string | null
  payment_type?: string | null
  payment_date?: string | Date | null
  created_at?: string | Date | null
  paid_to?: any
  attachments?: any[] | null
  metadata?: any
  /**
   * The inventory order this payment was recorded against, when it was reached
   * through the order rather than through the partner (#1710).
   *
   * 🔴 The whole defect. `POST /partners/inventory-orders/:id/submit-payment`
   * writes ONLY the order link, so two Completed INR 10,000 payments were
   * invisible to a ledger that reads exclusively through the partner link —
   * `recorded: 0` beside `outstanding: 28,200` on the very order they paid.
   * Reading both homes needs no backfill, so historical rows are covered too.
   */
  inventory_order_id?: string | null
  inventory_order_name?: string | null
  /** The payout this payment settles, via the direct link (#1710). */
  submission_id?: string | null
}

/**
 * A payment recorded against something a payout ALSO bills.
 *
 * 🔑 Advisory, never arithmetic. It is attached to the payout so the operator
 * reading "INR 28,200 outstanding" sees, on the same row, that INR 20,000 has
 * already moved against the order that payout bills. It is deliberately not
 * subtracted from `outstanding`: whether an order-linked payment discharges a
 * payout is a money decision a human makes by linking it (`submission_id`),
 * not one this fold may infer from a shared order id.
 */
export type RecordedAgainst = {
  payment_id: string
  amount: number
  status: string | null
  payment_type: string | null
  payment_date: string | null
  /** How this payment was tied to the payout. */
  via: "submission" | "inventory_order"
  inventory_order_id: string | null
  inventory_order_name: string | null
}

/**
 * A reconciliation says an `internal_payments` row came from a submission.
 *
 * 🔴 CORRECTED (#1710). This file used to assert it was the ONLY such thing,
 * because `defineLink(paymentSubmission, internalPayments)` generates a
 * 73-character table name and Postgres truncates identifiers at 63 bytes — so
 * the table "was never created, in either environment". That is wrong. Medusa
 * abbreviates each segment of an over-long link name to four characters and
 * appends a hash; the table exists, migrated, in both environments:
 *
 *     paym_subm_paym_subm_inte_paym_inte_paym-9812b09f
 *
 * It read as absent because it held ZERO ROWS — nothing ever wrote it. A
 * capability declared dead on a mechanism that was never the mechanism, so
 * nobody built the writer. `linkPaymentToSubmissionsStep` is that writer now,
 * and `PaymentLike.submission_id` below is how a linked row arrives here.
 *
 * The reconciliation path stays: it resolves the 5 historical rows, and it is
 * correctly null for everything written since #1638.
 */
export type ReconciliationLike = {
  reference_type?: string | null
  reference_id?: string | null
  payment_id?: string | null
  settled_at?: string | Date | null
}

export type LedgerEntry = {
  /** Stable React key. Prefixed so a submission and a payment cannot collide. */
  id: string
  /** Which record this is. Never inferred by the renderer. */
  kind: "payout" | "payment"
  status: string | null
  amount: number
  currency: string
  /** When this entry happened, for the single chronological ordering. */
  occurred_at: string | null

  // ── payout only ────────────────────────────────────────────────────────
  submission_id?: string | null
  /**
   * What the payout covered, reduced to exactly what `describePaymentLine`
   * reads. Not the whole item row: the panel needs the SOURCE, and shipping the
   * amounts too invites a second screen to re-derive a total from the lines
   * rather than trust `amount` — which underpaid a partner by 22% (#1596).
   */
  lines?: SubmissionItemLike[]
  submitted_at?: string | null
  reviewed_at?: string | null
  paid_at?: string | null
  notes?: string | null
  /**
   * The historical `internal_payments` row this payout was settled by, when one
   * exists. Attached rather than listed separately — the same money rendered
   * twice would double the totals a founder reads off this panel.
   */
  settled_by?: {
    payment_id: string
    payment_type: string | null
    payment_date: string | null
    status: string | null
  } | null
  /**
   * Money already recorded against something THIS payout bills (#1710).
   *
   * 🔴 The reading that pays someone twice is "INR 28,200 outstanding" printed
   * with no hint that INR 20,000 has moved against the same order. This is that
   * hint, attached to the row that makes the claim.
   *
   * ⚠️ Advisory. It never enters `paid` or `outstanding` — see `RecordedAgainst`.
   */
  recorded_against?: RecordedAgainst[]
  /** Sum of `recorded_against`. Advisory, for the same reason. */
  recorded_against_total?: number
  /**
   * What has been SETTLED against this payout — money a human linked to it
   * (#1710). Unlike `recorded_against` this is not advisory: it enters `paid`.
   *
   * Capped at the payout's own amount. A INR 30,000 payment linked to a INR
   * 28,200 payout settles 28,200 of it; the surplus belongs somewhere else and
   * must not make the partner look overpaid on this row.
   */
  settled_amount?: number
  /**
   * Credits a human APPLIED to this payout (#1712).
   *
   * 🔴 Unlike `recorded_against` this is NOT advisory — it enters `outstanding`.
   * The distinction is the whole design: a shared order id is evidence someone
   * should look, while an applied credit IS the decision, made by a human
   * naming the payout it discharges. Treating the first as arithmetic pays
   * twice; treating the second as advisory leaves a claim standing that
   * everyone agreed was already settled.
   */
  credits_applied?: Array<{
    credit_id: string
    amount: number
    reason: string | null
    applied_at: string | null
  }>
  /** Sum of `credits_applied`. Enters `credited`, and so `outstanding`. */
  credited_amount?: number

  // ── payment only ───────────────────────────────────────────────────────
  payment_type?: string | null
  payment_date?: string | null
  attachments?: any[]
  paid_to?: any
  /** Which inventory order this money was recorded against, if any (#1710). */
  inventory_order_id?: string | null
  inventory_order_name?: string | null
}

export type LedgerTotals = {
  /** Everything claimed and not rejected, at any status. */
  billed: number
  /**
   * Of that, what has actually been settled.
   *
   * Two ways a payout counts here, and they never double up:
   *
   *   1. its status is `Paid` — the whole amount, as before; or
   *   2. payments have been LINKED to it, which settles it in PART.
   *
   * 🔴 (2) is what makes a partial payout expressible at all (#1710). A payout
   * of INR 28,200 against which INR 20,000 has moved had no honest reading
   * before: `Paid` claims 28,200 moved, and `Approved` claims nothing did. Both
   * are wrong, and the second is the one that pays a partner twice.
   *
   * ⚠️ Only the DIRECT link counts — a human naming the payout a payment
   * settles. A reconciliation-derived association is provenance, not a
   * statement about how much is discharged, and letting it move `paid` would
   * silently restate historical numbers nobody re-examined.
   */
  paid: number
  /**
   * Of `billed`, what applied credits discharged (#1712).
   *
   * 🔑 Kept SEPARATE from `paid` rather than folded into it. `paid` means money
   * that moved against these payouts; `credited` means money that had already
   * moved, was recorded as a credit, and has now been named against a claim.
   * Summing them would make a partner's `paid` figure grow without a transfer,
   * and the next reader reconciling this screen against a bank statement would
   * find a number no statement can explain.
   */
  credited: number
  /** Still owed. `billed - paid - credited`. */
  outstanding: number
  /**
   * Historical money movement that NO payout accounts for. Deliberately not
   * added to `paid`: these rows predate the submission model, so summing them
   * together would count the 5 submission-derived ones twice and describe the
   * other 26 as if a payout existed for them.
   */
  recorded: number
  /**
   * Of `recorded`, what was recorded against a source an UNPAID payout bills
   * (#1710).
   *
   * 🔑 The anti-double-pay figure. `outstanding` says what the payouts still
   * claim; this says how much of that has money already sitting against it,
   * unmatched. On the order that opened #1710 it is INR 20,000 against INR
   * 28,200 outstanding.
   *
   * ⚠️ NOT subtracted from `outstanding`. Two Completed payments touching the
   * same order as a payout is evidence a human should look, not proof the
   * payout is discharged — an advance and a payout can legitimately coexist.
   * Linking the payment to the submission is how a human states that it does.
   */
  recorded_against_open: number
  /**
   * The currency all live submissions agree on, or null when they do not. A
   * caller must not render an aggregate against a null currency.
   */
  currency: string | null
}

/**
 * Union the payment rows a partner's money can arrive through, deduped by id
 * (#1710).
 *
 * 🔴 THE FIX. One payment has up to three homes — the partner link, the
 * inventory-order link, the submission link — and until this existed the ledger
 * read exactly one of them. Two Completed INR 10,000 rows lived only in the
 * order home, so the screen that answers "what do we owe this partner" reported
 * `recorded: 0` against `outstanding: 28,200` on the very order they paid.
 *
 * 🔑 Order matters, and it is the caller's: the FIRST source to supply a row
 * owns its provenance, and later sources may only FILL IN fields that are still
 * absent. A payment reached through the partner link keeps that identity while
 * still learning which order it was recorded against.
 *
 * PURE, so the union that decides whether money is visible at all can be tested
 * without a graph behind it.
 */
export const mergePaymentSources = (
  sources: Array<{
    rows: any[]
    /** Fields this source knows that the row itself does not carry. */
    attribution?: Record<string, any>
  }>
): PaymentLike[] => {
  const byId = new Map<string, any>()

  for (const source of sources) {
    for (const row of source.rows || []) {
      if (!row?.id) continue
      const extra = source.attribution || {}
      const existing = byId.get(row.id)
      if (existing) {
        for (const [k, v] of Object.entries(extra)) {
          if (v != null && existing[k] == null) existing[k] = v
        }
        continue
      }
      byId.set(row.id, { ...row, ...extra })
    }
  }

  return [...byId.values()]
}

const num = (v: unknown): number => {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

const iso = (v: unknown): string | null => {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(String(v))
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/**
 * The one status that means money has actually left.
 *
 * ⚠️ `Approved` is deliberately NOT here. Since #1639 approval stops at
 * `Approved` and `Paid` is written when the reconciliation settles. On prod the
 * gap between the two ran to 34 days, so counting Approved as paid would tell a
 * founder a partner is settled while the transfer is still owed.
 */
const PAID_STATUSES = new Set(["Paid"])

export const foldPartnerLedger = (input: {
  submissions: SubmissionLike[]
  items: SubmissionItemLike[]
  payments: PaymentLike[]
  reconciliations: ReconciliationLike[]
  /**
   * The partner's credits (#1712). Optional so every existing caller and test
   * keeps its meaning: a ledger folded without them reports `credited: 0`,
   * which is exactly what it reported before they existed.
   */
  credits?: CreditLike[]
}): { entries: LedgerEntry[]; totals: LedgerTotals } => {
  const { submissions, items, payments, reconciliations } = input
  const credits = input.credits || []

  const itemsBySubmission = new Map<string, SubmissionItemLike[]>()
  for (const item of items) {
    if (!item.submission_id) continue
    const list = itemsBySubmission.get(item.submission_id) || []
    list.push(item)
    itemsBySubmission.set(item.submission_id, list)
  }

  const submissionIds = new Set(submissions.map((s) => s.id))

  /**
   * payment id → the submission it settled.
   *
   * ⚠️ Only reconciliations that actually name both ends count. `payment_id` is
   * vestigial for anything written after #1638 and is null there, which is
   * correct: a modern payout has no `internal_payments` row to point at.
   */
  const settlementByPayment = new Map<string, ReconciliationLike>()
  const paymentBySubmission = new Map<string, string>()
  for (const rec of reconciliations) {
    if (rec.reference_type !== "payment_submission") continue
    if (!rec.payment_id || !rec.reference_id) continue
    if (!submissionIds.has(rec.reference_id)) continue
    settlementByPayment.set(rec.payment_id, rec)
    paymentBySubmission.set(rec.reference_id, rec.payment_id)
  }

  /**
   * The DIRECT link (#1710): a payment that names the submission it settles.
   *
   * 🔑 Applied ON TOP of the reconciliations, never instead — the 5 historical
   * rows have only a reconciliation, and this must not take their settlement
   * away. Every directly-linked payment is marked settled, so none of them can
   * also be reported as unmatched money against the same order.
   *
   * ⚠️ Where BOTH exist for one submission the reconciliation keeps the
   * `settled_by` slot, which is why the guard below is `!has` rather than an
   * overwrite. It is one display slot, not an arithmetic precedence: both
   * payments are attached either way, so neither total moves.
   */
  for (const p of payments) {
    if (!p.submission_id) continue
    if (!submissionIds.has(p.submission_id)) continue
    settlementByPayment.set(p.id, {
      reference_type: "payment_submission",
      reference_id: p.submission_id,
      payment_id: p.id,
    })
    if (!paymentBySubmission.has(p.submission_id)) {
      paymentBySubmission.set(p.submission_id, p.id)
    }
  }

  const paymentsById = new Map(payments.map((p) => [p.id, p]))

  /**
   * inventory order id → the payments recorded against it, for payments that no
   * payout already accounts for (#1710).
   *
   * A payment already attached as `settled_by` is excluded: it is described on
   * its payout as the money that settled it, and describing it a second time as
   * "unmatched money against the same order" would contradict that.
   */
  const paymentsByOrder = new Map<string, PaymentLike[]>()
  for (const p of payments) {
    if (!p.inventory_order_id) continue
    if (settlementByPayment.has(p.id)) continue
    const list = paymentsByOrder.get(p.inventory_order_id) || []
    list.push(p)
    paymentsByOrder.set(p.inventory_order_id, list)
  }

  const payoutEntries: LedgerEntry[] = submissions.map((submission) => {
    const settlingPaymentId = paymentBySubmission.get(submission.id)
    const settlingPayment = settlingPaymentId
      ? paymentsById.get(settlingPaymentId)
      : undefined

    const submitted = iso(submission.submitted_at)
    const paid = iso(submission.paid_at)

    /**
     * Money sitting against the orders THIS payout bills (#1710). Deduped by
     * payment id: one payout may bill several lines of the same order, and a
     * mixed payout may bill several orders that share a payment.
     */
    const lines = itemsBySubmission.get(submission.id) || []
    const seenPayment = new Set<string>()
    const recordedAgainst: RecordedAgainst[] = []
    for (const line of lines) {
      if (!line.inventory_order_id) continue
      for (const p of paymentsByOrder.get(line.inventory_order_id) || []) {
        if (seenPayment.has(p.id)) continue
        seenPayment.add(p.id)
        recordedAgainst.push({
          payment_id: p.id,
          amount: num(p.amount),
          status: p.status ?? null,
          payment_type: p.payment_type ?? null,
          payment_date: iso(p.payment_date),
          via: "inventory_order",
          inventory_order_id: line.inventory_order_id ?? null,
          inventory_order_name: line.inventory_order_name ?? null,
        })
      }
    }

    /**
     * Money a human LINKED to this payout, and so a statement that it is
     * discharged in part (#1710).
     *
     * 🔴 ONLY `Completed` settles. This is the same rule as `PAID_STATUSES`
     * above and it is load-bearing for the same reason (#1639): a payout must
     * not read as settled before the transfer happened. `Pending` is the status
     * the partner portal writes on a payment a partner records themselves — so
     * counting it here would let a partner move their own `paid` figure by
     * asserting they had been paid. The admin marking it `Completed` is the
     * only control on that assertion, and it is deliberately a human act.
     *
     * ⚠️ Deliberately STRICTER than `recorded_against_open`, which counts
     * Pending on purpose. A warning should over-fire; a settlement must not.
     */
    const SETTLES = new Set(["Completed"])
    const settledRaw = payments
      .filter((p) => p.submission_id === submission.id)
      .filter((p) => SETTLES.has(String(p.status ?? "")))
      .reduce((acc, p) => acc + num(p.amount), 0)

    const submissionAmount = num(submission.total_amount)
    const settledAmount =
      Math.round(Math.min(settledRaw, submissionAmount) * 100) / 100

    /**
     * Credits a human applied to THIS payout, by the shared rule the admin
     * route checks before writing one. Only `Applied` rows naming this
     * submission count — an `Open` credit has discharged nothing.
     */
    const applied = appliedCreditsFor(submission.id, credits)
    const appliedCreditsTotal = applied.total
    const appliedCredits = credits
      .filter((c) => applied.ids.includes(String(c.id ?? "")))
      .map((c) => ({
        credit_id: String(c.id ?? ""),
        amount: num(c.amount),
        reason: c.reason ?? null,
        applied_at: iso(c.applied_at),
      }))

    return {
      id: `payout:${submission.id}`,
      kind: "payout",
      status: submission.status ?? null,
      amount: num(submission.total_amount),
      currency: (submission.currency || "inr").toLowerCase(),
      occurred_at: paid || submitted || iso(submission.created_at),
      submission_id: submission.id,
      lines: lines.map((item) => ({
        id: item.id,
        submission_id: item.submission_id ?? null,
        source_type: item.source_type ?? null,
        design_id: item.design_id ?? null,
        design_name: item.design_name ?? null,
        task_id: item.task_id ?? null,
        task_name: item.task_name ?? null,
        inventory_order_id: item.inventory_order_id ?? null,
        inventory_order_name: item.inventory_order_name ?? null,
        order_id: item.order_id ?? null,
        production_run_ids: item.production_run_ids ?? null,
      })),
      submitted_at: submitted,
      reviewed_at: iso(submission.reviewed_at),
      paid_at: paid,
      notes: submission.notes ?? null,
      settled_by: settlingPayment
        ? {
            payment_id: settlingPayment.id,
            payment_type: settlingPayment.payment_type ?? null,
            payment_date: iso(settlingPayment.payment_date),
            status: settlingPayment.status ?? null,
          }
        : null,
      recorded_against: recordedAgainst,
      recorded_against_total: recordedAgainst.reduce(
        (acc, r) => acc + r.amount,
        0
      ),
      settled_amount: settledAmount,
      credits_applied: appliedCredits,
      credited_amount: appliedCreditsTotal,
    }
  })

  /**
   * Only the payments no payout already accounts for. A row attached above is
   * still visible — on its payout, saying how the money moved — but it is not a
   * second entry, and it is not a second contribution to the totals.
   */
  const standalonePayments = payments.filter(
    (p) => !settlementByPayment.has(p.id)
  )

  const paymentEntries: LedgerEntry[] = standalonePayments.map((p) => ({
    id: `payment:${p.id}`,
    kind: "payment",
    status: p.status ?? null,
    amount: num(p.amount),
    /** `internal_payments` carries no currency column; every row is rupees. */
    currency: "inr",
    occurred_at: iso(p.payment_date) || iso(p.created_at),
    payment_type: p.payment_type ?? null,
    payment_date: iso(p.payment_date),
    attachments: Array.isArray(p.attachments) ? p.attachments : [],
    paid_to: p.paid_to ?? null,
    inventory_order_id: p.inventory_order_id ?? null,
    inventory_order_name: p.inventory_order_name ?? null,
  }))

  const entries = [...payoutEntries, ...paymentEntries].sort((a, b) =>
    String(b.occurred_at || "").localeCompare(String(a.occurred_at || ""))
  )

  /**
   * ⚠️ Rejected is excluded from both totals, not just from `paid`. A rejected
   * claim never paid anyone and is not owed either — counting it as outstanding
   * would overstate what this partner is due.
   */
  const live = payoutEntries.filter((e) => e.status !== "Rejected")
  const billed = live.reduce((acc, e) => acc + e.amount, 0)
  /**
   * 🔴 A payout counts as paid EITHER by status OR by what has been linked to
   * it — never both, or a `Paid` payout with a linked payment would be counted
   * twice and report a partner as overpaid.
   *
   * The status wins outright where it is set: `Paid` means the whole payout
   * settled, whatever subset of payments happens to carry the link.
   */
  const paid = live.reduce((acc, e) => {
    if (PAID_STATUSES.has(String(e.status))) return acc + e.amount
    return acc + (e.settled_amount ?? 0)
  }, 0)

  /**
   * ⚠️ Credits on a payout that is already `Paid` are excluded, the same way
   * `paid` refuses to count status and settlement together. A Paid payout
   * contributes its whole amount to `paid`; also subtracting a credit from it
   * would push `outstanding` negative and report the partner as overpaid on a
   * row that is simply settled. The apply route refuses to create that state,
   * but a ledger must read historical rows it did not write.
   */
  const credited = live.reduce((acc, e) => {
    if (PAID_STATUSES.has(String(e.status))) return acc
    return acc + (e.credited_amount ?? 0)
  }, 0)

  const currencies = new Set(live.map((e) => e.currency))
  for (const e of paymentEntries) currencies.add(e.currency)

  return {
    entries,
    totals: {
      billed,
      paid,
      credited,
      outstanding: billed - paid - credited,
      recorded: paymentEntries.reduce((acc, e) => acc + e.amount, 0),
      /**
       * Counted once per PAYMENT, not once per payout that mentions it — two
       * open payouts billing the same order must not double the warning.
       * Only payouts that are not already Paid contribute: money against a
       * settled payout is history, not a double-pay risk.
       */
      recorded_against_open: (() => {
        const seen = new Set<string>()
        let total = 0
        for (const entry of live) {
          if (PAID_STATUSES.has(String(entry.status))) continue
          for (const r of entry.recorded_against || []) {
            if (seen.has(r.payment_id)) continue
            seen.add(r.payment_id)
            total += r.amount
          }
        }
        return total
      })(),
      currency: currencies.size === 1 ? [...currencies][0] : null,
    },
  }
}
