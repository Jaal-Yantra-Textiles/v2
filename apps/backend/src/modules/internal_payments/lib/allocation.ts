/**
 * Whether a named share of a payment may be written (#2523). Pure, so the
 * refusals are testable without a database.
 *
 * 🔑 Refuse, never clamp. A share silently cut to fit is a number the founder
 * did not type, and the next reader would find a bill "paid" by an amount that
 * appears in no bank statement and no conversation.
 */
export type AllocationCheck =
  | { ok: true }
  | { ok: false; message: string }

const round2 = (n: number) => Math.round(n * 100) / 100

export const checkAllocation = (input: {
  paymentId: string
  submissionId: string
  amount: number
  paymentAmount: number
  /** Shares of this payment already named for OTHER payouts. */
  otherShares: number
  payoutTotal: number
}): AllocationCheck => {
  const { amount, paymentAmount, otherShares, payoutTotal } = input

  if (!Number.isFinite(amount) || amount < 0) {
    return { ok: false, message: "amount must be zero or more" }
  }

  if (amount > payoutTotal) {
    return {
      ok: false,
      message: `Payout ${input.submissionId} is for ${round2(payoutTotal)}; a share of ${round2(amount)} is more than it bills.`,
    }
  }

  const free = round2(paymentAmount - otherShares)
  if (round2(amount) > free) {
    return {
      ok: false,
      message: `Payment ${input.paymentId} is ${round2(paymentAmount)}, and ${round2(otherShares)} of it is already named for other payouts — only ${free} is left to give this one, not ${round2(amount)}.`,
    }
  }

  return { ok: true }
}
