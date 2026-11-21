/**
 * Edit a design order while its deposit is still UNPAID (#2566).
 *
 * ## Why
 *
 * Reprice and amend refused on any cart with a payment schedule, because the
 * schedule stores `total_due` / `deposit_amount` / `balance_amount` and a
 * changed total would leave them disagreeing. But the founder sets a deposit
 * the moment an order is created (Sreeni Vasan: 70% on 17 Nov) — so every such
 * order was frozen, and "add one more trouser" meant cancel and re-issue.
 *
 * A PERCENTAGE deposit nobody has paid has nothing to protect: re-split it on
 * the new total and the buyer is simply asked for 70% of the right number.
 * That is what this does. Everything else still refuses:
 *
 * - a PAID deposit — money was taken against the old split.
 * - a QUOTE schedule — that split is the deal the buyer accepted.
 * - a FIXED-amount deposit — "₹800 down" was agreed as a number, and it may
 *   not fit the new total. Replace it (`set_design_order_deposit` with
 *   `replace: true`) and edit after.
 */

export type ScheduleLike = {
  id: string
  source_type?: string | null
  deposit_status?: string | null
  deposit_pct?: number | string | null
  deposit_amount?: number | string | null
  balance_trigger?: string | null
} | null | undefined

/** Null when the order may be edited; otherwise the plain-words reason. */
export const depositBlocksEdit = (schedule: ScheduleLike): string | null => {
  if (!schedule) return null
  if (schedule.deposit_status !== "pending") {
    return (
      "This design order's deposit has already been paid, so its total is fixed. " +
      "Change it through the order once it is converted."
    )
  }
  if (schedule.source_type !== "manual") {
    return "This order's deposit comes from an accepted quote; its split is the deal the buyer accepted."
  }
  if (schedule.deposit_pct === null || schedule.deposit_pct === undefined) {
    return (
      "This design order has a FIXED deposit amount, which may not fit a new total. " +
      "Replace it with a percentage (or a new amount) first, then edit."
    )
  }
  return null
}

/**
 * Re-split an unpaid percentage deposit on the cart's new total. Call AFTER
 * the cart's tax is refreshed, with that refreshed total.
 */
export const resyncManualDeposit = async (
  schedules: any,
  schedule: NonNullable<ScheduleLike>,
  newTotal: number,
  setBy: string | null
) => {
  if (!Number.isFinite(newTotal) || newTotal <= 0) {
    throw new Error(`Cannot re-split the deposit on a total of ${newTotal}.`)
  }
  return await schedules.replaceManualDeposit(schedule.id, {
    total_due: newTotal,
    quote_deposit_pct: Number(schedule.deposit_pct),
    fixed_deposit_amount: null,
    metadata: {
      resynced_at: new Date().toISOString(),
      resynced_by: setBy,
      resynced_from: {
        deposit_pct: Number(schedule.deposit_pct),
        deposit_amount: Number(schedule.deposit_amount),
      },
    },
  })
}
