/**
 * Record a design-order DEPOSIT received outside the gateways — a bank
 * transfer, cash, a UPI payment to our own account (#2570).
 *
 * Before this the only admin path was `convert_design_order` "prepaid", which
 * captures the FULL total: a buyer who wired 70% showed as fully paid, no
 * balance was ever owed in the books, and no "balance due after delivery"
 * email went out. Convert with `payment_mode: "deposit"` captures only the
 * deposit and leaves the rest outstanding on the order, exactly as a PayU
 * deposit checkout does.
 *
 * Pure: decides the figures; the convert workflow writes them.
 */

export type ManualDepositSchedule = {
  id: string
  source_type?: string | null
  deposit_status?: string | null
  deposit_pct?: number | string | null
  deposit_amount?: number | string | null
} | null | undefined

export type ManualDepositPlan =
  | { ok: true; deposit: number; balance: number; total: number }
  | { ok: false; message: string }

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * @param taxedTotal   the converted order's total, GST included
 * @param amountReceived what actually arrived, if the admin gives it — wins
 *        over the schedule's figure (a buyer who wired ₹20,000 against a
 *        ₹20,579 deposit paid ₹20,000)
 */
export const planManualDeposit = (input: {
  schedule: ManualDepositSchedule
  taxedTotal: number
  amountReceived?: unknown
}): ManualDepositPlan => {
  const { schedule } = input
  const total = Number(input.taxedTotal)

  if (!Number.isFinite(total) || total <= 0) {
    return { ok: false, message: "The order has no total to take a deposit against." }
  }

  let deposit: number
  if (input.amountReceived !== undefined && input.amountReceived !== null) {
    // typeof first: Number(null) and Number("") are 0.
    deposit = typeof input.amountReceived === "number" ? input.amountReceived : NaN
    if (!Number.isFinite(deposit) || deposit <= 0) {
      return { ok: false, message: "amount_received must be a number greater than 0." }
    }
  } else {
    if (!schedule) {
      return {
        ok: false,
        message:
          "This design order has no deposit set. Set one (set_design_order_deposit) or pass amount_received.",
      }
    }
    if (schedule.deposit_pct !== null && schedule.deposit_pct !== undefined) {
      deposit = round2((total * Number(schedule.deposit_pct)) / 100)
    } else {
      deposit = Number(schedule.deposit_amount)
    }
  }

  if (schedule && (schedule.source_type !== "manual" || schedule.deposit_status !== "pending")) {
    return {
      ok: false,
      message:
        schedule.deposit_status !== "pending"
          ? "This order's deposit is already recorded as paid."
          : "This order's deposit comes from a quote; record it through the quote's checkout.",
    }
  }

  deposit = round2(deposit)
  if (!(deposit < total)) {
    return {
      ok: false,
      message: `A deposit of ${deposit} is not less than the order total ${total} — that is full payment; convert as "prepaid" instead.`,
    }
  }

  return { ok: true, deposit, balance: round2(total - deposit), total }
}
