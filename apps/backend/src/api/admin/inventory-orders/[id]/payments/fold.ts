/**
 * Fold a set of payout LINES naming one inventory order into what the order
 * page shows (#1622). Pure, so the arithmetic that says "paid of billed" can be
 * tested without a database behind it.
 */

export type PayoutLineLike = {
  id: string
  submission_id?: string | null
  amount?: number | string | null
  quantity?: number | null
  unit_amount?: number | string | null
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

export type SubmissionLike = {
  id: string
  status?: string | null
  total_amount?: number | string | null
  partner_id?: string | null
  currency?: string | null
  created_at?: string | Date | null
  reviewed_at?: string | Date | null
  notes?: string | null
}

/**
 * The one status that means money has actually left.
 *
 * ⚠️ `Approved` is deliberately NOT here. An approved submission has a payment
 * record but `markSubmissionPaidStep` is what flips it to Paid; counting
 * Approved as paid would tell an order it is settled while the transfer is
 * still owed.
 */
const PAID_STATUSES = new Set(["Paid"])

const num = (v: unknown): number => {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

export const foldOrderPayouts = (
  items: PayoutLineLike[],
  submissions: SubmissionLike[]
) => {
  const byId = new Map(submissions.map((s) => [s.id, s]))

  const payouts = items
    .map((item) => {
      const submission = item.submission_id ? byId.get(item.submission_id) : undefined

      return {
        line_id: item.id,
        submission_id: item.submission_id ?? null,
        submission_status: submission?.status ?? null,
        submission_total:
          submission?.total_amount != null ? num(submission.total_amount) : null,
        partner_id: submission?.partner_id ?? null,
        currency: submission?.currency ?? null,
        created_at: submission?.created_at ?? null,
        reviewed_at: submission?.reviewed_at ?? null,
        /** What THIS order contributes to that payout — not the total. */
        amount: num(item.amount),
        quantity: item.quantity ?? null,
        unit_amount: item.unit_amount != null ? num(item.unit_amount) : null,
        notes: submission?.notes ?? null,
        /**
         * Everything `describePaymentLine` needs, so the panel labels the line
         * with the shared vocabulary rather than inventing its own. The last
         * time each screen decided for itself, two of four source types
         * rendered nowhere at all (#1621).
         */
        source_type: item.source_type ?? null,
        design_id: item.design_id ?? null,
        design_name: item.design_name ?? null,
        task_id: item.task_id ?? null,
        task_name: item.task_name ?? null,
        inventory_order_id: item.inventory_order_id ?? null,
        inventory_order_name: item.inventory_order_name ?? null,
        order_id: item.order_id ?? null,
        production_run_ids: item.production_run_ids ?? null,
      }
    })
    .sort((a, b) =>
      String(b.created_at || "").localeCompare(String(a.created_at || ""))
    )

  return {
    payouts,
    /** Everything billed against this order, at any status. */
    billed: payouts.reduce((acc, p) => acc + p.amount, 0),
    /** Of that, what a Paid submission covers. */
    paid: payouts
      .filter((p) => PAID_STATUSES.has(String(p.submission_status)))
      .reduce((acc, p) => acc + p.amount, 0),
  }
}
