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
}

/**
 * A reconciliation is the only thing that says an `internal_payments` row came
 * from a submission — there is no link between the two and there never was.
 * The generated link table name is 73 characters, past PostgreSQL's 63-byte
 * identifier limit, so `defineLink` skipped it in silence.
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

  // ── payment only ───────────────────────────────────────────────────────
  payment_type?: string | null
  payment_date?: string | null
  attachments?: any[]
  paid_to?: any
}

export type LedgerTotals = {
  /** Everything claimed and not rejected, at any status. */
  billed: number
  /** Of that, what a `Paid` submission covers. */
  paid: number
  /** Still owed. `billed - paid`. */
  outstanding: number
  /**
   * Historical money movement that NO payout accounts for. Deliberately not
   * added to `paid`: these rows predate the submission model, so summing them
   * together would count the 5 submission-derived ones twice and describe the
   * other 26 as if a payout existed for them.
   */
  recorded: number
  /**
   * The currency all live submissions agree on, or null when they do not. A
   * caller must not render an aggregate against a null currency.
   */
  currency: string | null
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
}): { entries: LedgerEntry[]; totals: LedgerTotals } => {
  const { submissions, items, payments, reconciliations } = input

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

  const paymentsById = new Map(payments.map((p) => [p.id, p]))

  const payoutEntries: LedgerEntry[] = submissions.map((submission) => {
    const settlingPaymentId = paymentBySubmission.get(submission.id)
    const settlingPayment = settlingPaymentId
      ? paymentsById.get(settlingPaymentId)
      : undefined

    const submitted = iso(submission.submitted_at)
    const paid = iso(submission.paid_at)

    return {
      id: `payout:${submission.id}`,
      kind: "payout",
      status: submission.status ?? null,
      amount: num(submission.total_amount),
      currency: (submission.currency || "inr").toLowerCase(),
      occurred_at: paid || submitted || iso(submission.created_at),
      submission_id: submission.id,
      lines: (itemsBySubmission.get(submission.id) || []).map((item) => ({
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
  const paid = live
    .filter((e) => PAID_STATUSES.has(String(e.status)))
    .reduce((acc, e) => acc + e.amount, 0)

  const currencies = new Set(live.map((e) => e.currency))
  for (const e of paymentEntries) currencies.add(e.currency)

  return {
    entries,
    totals: {
      billed,
      paid,
      outstanding: billed - paid,
      recorded: paymentEntries.reduce((acc, e) => acc + e.amount, 0),
      currency: currencies.size === 1 ? [...currencies][0] : null,
    },
  }
}
