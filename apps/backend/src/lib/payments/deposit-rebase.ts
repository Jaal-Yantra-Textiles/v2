/**
 * What `order.placed` writes onto a MANUAL (design-order) deposit schedule
 * (#2645, hardening after #176).
 *
 * A manual deposit is set before tax and freight are final, so at placement
 * the schedule is re-based on the order as placed. Before this the re-base
 * took whatever checkout COLLECTED as "the deposit" — so when #176's 50%
 * deposit was charged in full (195 AUD, not 97.50), the schedule was quietly
 * rewritten to "deposit 195, balance 0" and nothing looked wrong.
 *
 * ## The rule
 *
 * The planned deposit is the agreement: `deposit_pct` of the ORDER total
 * (rounded to the cent), or the fixed amount. Then:
 *
 * - **match** (within a cent): re-base, deposit = what was collected.
 * - **over** (collected more than planned): FLAG, and keep the PLANNED split
 *   on the order total. Not refused — the money has already moved and the
 *   deposit did land, so the deposit is still marked paid. But the schedule
 *   keeps saying what was agreed, and because the order now reports less
 *   outstanding than the schedule's balance, `request_order_balance` refuses
 *   to raise anything until a human refunds the difference (or reconciles).
 *   That is the money-safe direction: re-basing would hide the overcharge,
 *   and writing the planned balance as collectable without the order agreeing
 *   would invite charging the buyer a second time.
 * - **under** (collected less than planned): FLAG, and re-base on what was
 *   collected. The balance then carries the shortfall, so the buyer still pays
 *   exactly the order total in sum and never more. Keeping the planned figure
 *   would record money we never received as paid, and the balance could never
 *   be raised.
 *
 * Pure: the subscriber does the writes.
 */

export type RebaseVerdict = {
  kind: "match" | "over" | "under" | "skip"
  /** Figures to write, or null to leave the schedule's figures alone. */
  write: { total: number; deposit: number; balance: number } | null
  /** Admin-facing alert ("{CUR}" is replaced by the caller), or null. */
  alert: string | null
  planned: number | null
}

const round2 = (n: number): number => {
  const scaled = n * 100
  return Math.round(scaled + Math.sign(scaled) * Number.EPSILON * Math.abs(scaled)) / 100
}

/** Half a cent either way is rounding, not money. */
const TOLERANCE = 0.01

export const decideDepositRebase = (input: {
  orderTotal: unknown
  collected: unknown
  depositPct: unknown
  fixedDeposit: unknown
}): RebaseVerdict => {
  const total = Number(input.orderTotal)
  const collected = Number(input.collected)
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(collected) || collected <= 0) {
    return { kind: "skip", write: null, alert: null, planned: null }
  }

  // 🔴 typeof/null first: Number(null) is 0, and 0 is a finite "percentage".
  const pctGiven = input.depositPct !== null && input.depositPct !== undefined && input.depositPct !== ""
  const pct = pctGiven ? Number(input.depositPct) : NaN
  const fixedGiven =
    input.fixedDeposit !== null && input.fixedDeposit !== undefined && input.fixedDeposit !== ""
  const fixed = fixedGiven ? Number(input.fixedDeposit) : NaN

  const planned =
    Number.isFinite(pct) && pct > 0 && pct < 100
      ? round2((total * pct) / 100)
      : !pctGiven && Number.isFinite(fixed) && fixed > 0
        ? round2(fixed)
        : null

  const rebaseOnCollected = (kind: RebaseVerdict["kind"], alert: string | null): RebaseVerdict =>
    collected <= total
      ? {
          kind,
          write: { total, deposit: collected, balance: round2(total - collected) },
          alert,
          planned,
        }
      : { kind, write: null, alert, planned }

  if (planned === null) {
    // Nothing to compare against: the old behaviour, as before.
    return rebaseOnCollected("match", null)
  }

  const what = Number.isFinite(pct) && pctGiven ? `a ${pct}% deposit` : "a fixed deposit"
  const diff = round2(collected - planned)

  if (diff > TOLERANCE) {
    const keep = planned < total
    return {
      kind: "over",
      write: keep ? { total, deposit: planned, balance: round2(total - planned) } : null,
      alert:
        `was meant to take ${what} (${planned} {CUR}) but collected ${collected} {CUR}. ` +
        `The buyer was overcharged by ${diff} {CUR}. ` +
        (keep
          ? `The schedule keeps the planned deposit ${planned} and balance ${round2(total - planned)}; the balance cannot be raised until the order and schedule agree. `
          : "") +
        `Refund the difference; if a refund turns the order "fully paid", run the reinstate-balance-from-credit-line job. ` +
        `No "deposit received" email was sent to the buyer.`,
      planned,
    }
  }

  if (diff < -TOLERANCE) {
    return rebaseOnCollected(
      "under",
      `was meant to take ${what} (${planned} {CUR}) but collected only ${collected} {CUR}. ` +
        `The schedule records the ${collected} actually collected; the balance carries the ${round2(-diff)} {CUR} shortfall.`
    )
  }

  return rebaseOnCollected("match", null)
}
