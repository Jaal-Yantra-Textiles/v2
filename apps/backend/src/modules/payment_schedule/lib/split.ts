/**
 * Splitting a total into a deposit and a balance (#1439 S11, #959 Slice C).
 *
 * PURE. No container, no DB — so the arithmetic that decides how much a buyer
 * is asked for can be tested without standing anything up.
 */

/** The platform default when neither the quote nor the partner names one. */
export const DEFAULT_DEPOSIT_PCT = 30

export type DepositSplit = {
  deposit_pct: number
  deposit_amount: number
  balance_amount: number
}

/**
 * Round to 2 decimal places without the floating-point surprise.
 *
 * `Math.round(x * 100) / 100` is wrong often enough to matter: 1.005 * 100 is
 * 100.49999999999999 in IEEE-754, so the naive form rounds it DOWN. The epsilon
 * nudge is scaled to the magnitude rather than a constant, so it survives the
 * six-figure totals a bulk quote actually carries.
 */
const round2 = (n: number): number => {
  const scaled = n * 100
  return Math.round(scaled + Math.sign(scaled) * Number.EPSILON * Math.abs(scaled)) / 100
}

/**
 * Split `total` into a deposit and a balance.
 *
 * 🔑 **The balance is the remainder, never a second percentage.** Computing
 * both ends independently is how a split silently loses (or invents) a unit of
 * currency: 30% and 70% of 1000.05 do not add back to 1000.05 once each is
 * rounded. Here `deposit + balance === total` by construction, which is the one
 * property the ledger has to hold.
 *
 * Both ends are clamped into `[0, total]`, so a nonsense percentage produces a
 * defensible schedule rather than a negative balance. A 0% deposit is legal and
 * means "invoice the lot later"; 100% means "pay up front", which is the normal
 * retail case and therefore must not be special-cased into an error.
 */
export const splitDeposit = (
  total: number,
  pct: number | null | undefined
): DepositSplit => {
  const safeTotal = Number.isFinite(Number(total)) ? Math.max(0, Number(total)) : 0
  // 🔴 `Number(null)` is 0, and 0 is finite — so a plain `Number.isFinite`
  // guard turns "nobody named a percentage" into "take nothing up front", and
  // the buyer is asked for no deposit at all. Null and undefined are checked
  // first, and only then is the value tested for being a number. Found by the
  // test below, not by reading this line.
  const named = pct !== null && pct !== undefined && Number.isFinite(Number(pct))
  const rawPct = named ? Number(pct) : DEFAULT_DEPOSIT_PCT
  const safePct = Math.min(100, Math.max(0, rawPct))

  const deposit = Math.min(safeTotal, Math.max(0, round2((safeTotal * safePct) / 100)))
  const balance = round2(safeTotal - deposit)

  return {
    deposit_pct: safePct,
    deposit_amount: deposit,
    balance_amount: balance,
  }
}

/**
 * Which percentage applies, in the order the business actually negotiates:
 * the deal, then the partner's house terms, then the platform default.
 *
 * `null` and `undefined` fall through; **`0` does not**. A partner who agreed
 * to take nothing up front means it, and `||` would have silently overwritten
 * that with 30% — the same class of bug as treating an absent allocation as an
 * empty one.
 */
export const resolveDepositPct = (
  quotePct?: number | null,
  partnerPct?: number | null
): number => {
  if (quotePct !== null && quotePct !== undefined && Number.isFinite(Number(quotePct))) {
    return Number(quotePct)
  }
  if (
    partnerPct !== null &&
    partnerPct !== undefined &&
    Number.isFinite(Number(partnerPct))
  ) {
    return Number(partnerPct)
  }
  return DEFAULT_DEPOSIT_PCT
}
