/**
 * What an approved run's product is listed at, and in what currency (#1914).
 *
 * PURE, and separate from `approve-run-output` on purpose: this is the money
 * rule, it is the part worth exercising exhaustively, and a container is not
 * needed to decide it.
 *
 * ── What was wrong ────────────────────────────────────────────────────────
 *
 * Approval listed a product at `design.estimated_cost ?? 0`. Three faults in
 * one expression:
 *
 *  1. It never looked at what the run COST. `computeRunCostSummary` derives a
 *     `cost_per_unit` from real consumption logs — material, energy, labour,
 *     partner estimate — and approval ignored all of it in favour of a number
 *     someone typed on the design, possibly months earlier.
 *  2. `?? 0` listed at ZERO when the estimate was absent. A price of 0 is not a
 *     blank: it is a claim, and #1900 caught it reaching the storefront.
 *  3. There was no margin at all. The listed price WAS the cost, so every
 *     approved product sold at cost.
 *
 * ── The rule ──────────────────────────────────────────────────────────────
 *
 * price = cost per unit × 1.40, cost taken from the run where the run knows it
 * and from the design's estimate only where it does not. A run with neither is
 * REFUSED rather than listed at zero — an approval that cannot price its output
 * has not finished, and saying so is the whole point of #1900.
 */

/**
 * The markup applied to cost. 1.40 = list at 140% of cost.
 *
 * ⚠️ This is a MARKUP ON COST, not a margin on the sale price: at ×1.40 the
 * margin is 28.6% (0.4/1.4), not 40%. Stated because the two are routinely
 * confused and the difference is real money — a 40% MARGIN would be ÷0.6,
 * i.e. ×1.667. The founder's call (2026-09-08) was the ×1.40 shape, with the
 * worked examples 165 -> 231 and 690 -> 966.
 */
export const APPROVAL_MARKUP = 1.4

/** Where the cost behind a listed price came from. Recorded, not inferred. */
export type PriceSource = "run_cost" | "design_estimate"

export type ApprovalPrice = {
  /** Listed price in major units, already marked up. */
  price: number
  /** The pre-markup cost the price was derived from. */
  cost: number
  source: PriceSource
}

/**
 * PURE: round to 2dp without floating-point drift.
 *
 * Medusa 2.x prices are DECIMAL major units (see create-product-from-design's
 * note: this codebase had exactly one place that multiplied by 100, a Medusa v1
 * habit, and it over-priced by 100x). So this rounds a decimal, it does not
 * convert to minor units.
 */
const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100

/** A usable positive number, or null. `0` and `NaN` are both "no figure". */
const positive = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * PURE: the price to list, or `null` when there is no cost to derive one from.
 *
 * 🔴 `null` means REFUSE, not "list at zero". The caller must surface it as a
 * failure naming the run; a silent 0 is the defect this replaces.
 *
 * The run's own cost wins wherever it exists. A run with no consumption logs
 * has `cost_per_unit: null` — nothing was recorded against it — and the
 * design's estimate is the only figure left; it is a worse answer than the
 * run's actual cost but a far better one than nothing.
 *
 * ⚠️ Zero is treated as ABSENT on both inputs, deliberately. A run whose logs
 * sum to 0 has not been costed rather than cost nothing, and `Number(null)` is
 * `0` — so a `!= null` guard here would let a missing figure through as free
 * goods. Ask `> 0`, never `!= null`.
 */
export function resolveApprovalPrice(input: {
  runCostPerUnit?: number | null
  designEstimatedCost?: number | null
  markup?: number
}): ApprovalPrice | null {
  const markup = input.markup ?? APPROVAL_MARKUP

  const runCost = positive(input.runCostPerUnit)
  if (runCost !== null) {
    return { price: round2(runCost * markup), cost: runCost, source: "run_cost" }
  }

  const estimate = positive(input.designEstimatedCost)
  if (estimate !== null) {
    return {
      price: round2(estimate * markup),
      cost: estimate,
      source: "design_estimate",
    }
  }

  return null
}

/**
 * PURE. The currency a design's product is listed in.
 *
 * 🔴 The approve route once hardcoded `"usd"` on a platform trading in AUD and
 * INR, so every approved design was listed in a currency nobody sells in. That
 * was fixed to prefer the design's own `cost_currency`, but `"usd"` survived as
 * the last resort — which still mis-priced any design that never recorded one.
 *
 * The last resort is **INR**: production is costed in INR (the unified order
 * carries `currency_assumed: true` for exactly this reason), so a design with
 * no stated currency was costed in INR whatever the fallback claimed.
 * ── The RUN answers first (#1979) ─────────────────────────────────────────
 *
 * A production run now states `cost_currency` of its own, and it is asked
 * BEFORE the design. The design's figure is an estimate typed once; the run's
 * is what the work actually cost, and `resolveApprovalPrice` already prefers
 * the run's cost over the design's estimate for exactly that reason. Asking the
 * design for the currency of a number the RUN supplied would let the two
 * disagree — a price denominated by one record and valued by another.
 *
 * ── Why the STORE default is not asked (#1979) ────────────────────────────
 *
 * It used to sit between the two, as `designCurrency || storeCurrency || "inr"`.
 * `JYT Medu Store`'s default is EUR, so the INR last resort was UNREACHABLE on
 * the only store we sell from — the very case it was written for. A design
 * costed at ₹2,634.75 minted as €2,634.75 and fanned out to **₹291,560**, about
 * 110× its cost, and `replay-fx-fanout` propagated that base into all 11
 * currencies. The #1805 fix for the hardcoded `"usd"` had reintroduced the same
 * bug wearing a different currency.
 *
 * 🔑 The rule it violated: **a cost is denominated by how it was COMPUTED, not
 * by where the garment is SOLD.** `cost_breakdown` line items come from
 * `cost_source: "order_history"` — rupees — and no amount of selling in Europe
 * turns them into euros. The store default answers a different question, so it
 * is not asked here at all; `storeCurrency` is absent from the input type on
 * purpose, so that re-adding it has to be a deliberate edit rather than a
 * plausible-looking `||`.
 */
export const APPROVAL_FALLBACK_CURRENCY = "inr"

export function resolveApprovalCurrency(input: {
  /** What the RUN says its cost is in. Wins: it denominates the cost used. */
  runCurrency?: string | null
  designCurrency?: string | null
}): string {
  /**
   * ⚠️ Trimmed BEFORE the choice, not after. `"   "` is truthy, so a trailing
   * `||` would pick it and the later `.trim()` would hand back `""` — an empty
   * currency code, which is worse than a guessed one because nothing
   * downstream reads it as missing. Same family as the `''` that satisfied an
   * `is not null` CHECK elsewhere in this codebase.
   */
  const stated =
    String(input.runCurrency ?? "").trim() ||
    String(input.designCurrency ?? "").trim()
  return (stated || APPROVAL_FALLBACK_CURRENCY).toLowerCase()
}

/**
 * Whether `resolveApprovalCurrency` had to ASSUME rather than read.
 *
 * The fallback is the best available answer, not a known one, and a price whose
 * currency was guessed is worth saying out loud — 42 of 43 costed designs on
 * prod carried no `cost_currency` when #1979 was found, so this is the common
 * case rather than the rare one.
 *
 * ⚠️ Tests the RAW field before any coercion: `""` is falsy but not null, the
 * shape that defeated an `is not null` CHECK elsewhere in this codebase.
 */
export function approvalCurrencyWasAssumed(
  designCurrency?: string | null,
  runCurrency?: string | null
): boolean {
  return (
    String(runCurrency ?? "").trim() === "" &&
    String(designCurrency ?? "").trim() === ""
  )
}
