/**
 * How a payout's status colours itself.
 *
 * PURE, and shared for the same reason `describePaymentLine` is: the moment
 * each screen decides for itself, the screens disagree. `submissions-tab` had
 * this switch inline; #1622 adds a second surface (the inventory order), and a
 * copied switch is how two screens start disagreeing about what "Approved"
 * looks like.
 *
 * ⚠️ SUBMISSION statuses only. `reconciliation-tab` carries its own vocabulary
 * (Matched / Settled / Discrepant / Waived) and colours `Settled` blue where a
 * submission would be green. It is not a copy of this one and must not be
 * folded into it.
 */
export type PaymentSubmissionStatusColor =
  | "green"
  | "orange"
  | "red"
  | "grey"
  | "blue"
  | "purple"

export const paymentSubmissionStatusColor = (
  status: string | null | undefined
): PaymentSubmissionStatusColor => {
  switch (status) {
    case "Paid":
      return "green"
    case "Approved":
      return "blue"
    case "Pending":
    case "Under_Review":
      return "orange"
    case "Rejected":
      return "red"
    default:
      return "grey"
  }
}

/** Statuses as a human reads them — the enum uses an underscore. */
export const paymentSubmissionStatusLabel = (
  status: string | null | undefined
): string => (status ? String(status).replace("_", " ") : "Unknown")

/**
 * The SECOND thing a payout row has to say: has the money arrived?
 *
 * 🔴 A payout's `status` answers "how far through approval is this", and the
 * ledger's `paid` total answers "has the money moved". They are different
 * axes, and the row rendered only the first — so a payout reading **Pending**
 * sat directly above a footer reading *"₹1,000.00 paid"*. The founder read
 * that as a double-count and asked whether approving it would make the total
 * 2,000. It would not; but a row that prompts that question is wrong.
 *
 * That state is not exotic. It is what recording historical money against work
 * paid out of band always produces, and the 2026-09-01 reconciliation created
 * three of them in one afternoon. It will recur every time.
 *
 * 🔑 This is the slim survivor of "one payout, three records, three statuses"
 * (#1636): the records were merged, but two different questions still share one
 * row. So answer both, side by side, rather than letting the approval state
 * silently contradict the money.
 *
 * ⚠️ Returns null for `Paid` — that status already says the money arrived, and
 * a second badge beside it is noise.
 */
export type PayoutSettlementBadge = {
  label: string
  color: PaymentSubmissionStatusColor
} | null

export const payoutSettlementBadge = (entry: {
  status?: string | null
  amount?: number | null
  settled_amount?: number | null
}): PayoutSettlementBadge => {
  const amount = Number(entry.amount ?? 0)
  const settled = Number(entry.settled_amount ?? 0)

  if (!Number.isFinite(amount) || amount <= 0) return null
  if (!Number.isFinite(settled) || settled <= 0) return null
  if (String(entry.status ?? "") === "Paid") return null

  /**
   * ⚠️ A cent of tolerance. `settled_amount` is a rounded sum of payment rows
   * and the payout total is stored separately; an exact `>=` would report a
   * fully-settled payout as merely partial on a rounding difference.
   */
  if (settled + 0.005 >= amount) return { label: "settled", color: "green" }

  return { label: "part settled", color: "blue" }
}
