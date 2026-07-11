/**
 * Derive the "value" of a convertible instrument (SAFE / note) for display
 * (#969 follow-up). Pure — no I/O — so it's unit-testable and reused by both
 * the admin and investor routes.
 *
 * A convertible holder has no shares until conversion, so value is *implied*:
 *  - principal            → the cash invested (cost basis; always known)
 *  - implied_ownership_pct → for a post-money SAFE this is simply
 *                            principal / valuation_cap (the investor's floor)
 *  - implied_value        → implied_ownership_pct × a reference valuation
 *                            (the company's current/post-money valuation, or the
 *                            cap when no fresher valuation is available)
 *  - multiple             → implied_value / principal (MOIC estimate)
 *
 * Everything is best-effort: fields that can't be derived come back null so the
 * UI can show "—" rather than a fabricated number.
 */
export type ConvertibleValueInput = {
  principal_amount?: number | string | null
  valuation_cap?: number | string | null
  discount_rate?: number | null
  safe_type?: "post_money" | "pre_money" | null
  status?: string | null
  conversion_shares?: number | string | null
  conversion_price_per_share?: number | string | null
  // CCPS (iSAFE) extras. A preference share carries a liquidation-preference
  // floor: on a downside the holder gets back at least `principal × multiple`
  // before common. Economically that's the only difference from a plain SAFE —
  // cap/discount conversion math is otherwise identical.
  instrument_type?: "safe" | "convertible_note" | "ccps" | null
  liquidation_preference_multiple?: number | null
}

export type ConvertibleValue = {
  principal: number
  implied_ownership_pct: number | null
  implied_value: number | null
  multiple: number | null
  // How implied_value was derived, so the UI can label it honestly.
  basis: "converted" | "reference_valuation" | "cap" | "principal" | "unknown"
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null
  const n = typeof v === "string" ? parseFloat(v) : (v as number)
  return Number.isFinite(n) ? n : null
}

export function computeConvertibleValue(
  c: ConvertibleValueInput,
  opts: { referenceValuation?: number | string | null } = {}
): ConvertibleValue {
  const principal = num(c.principal_amount) ?? 0
  const cap = num(c.valuation_cap)
  const discount = num(c.discount_rate)
  const ref = num(opts.referenceValuation)
  const isPostMoney = (c.safe_type ?? "post_money") === "post_money"

  // CCPS liquidation-preference floor: a preference holder can't be worth less
  // than their guaranteed return, so no implied value should print below it.
  const prefMultiple = num(c.liquidation_preference_multiple)
  const prefFloor =
    c.instrument_type === "ccps" && prefMultiple && prefMultiple > 0
      ? principal * prefMultiple
      : null
  const applyFloor = (r: ConvertibleValue): ConvertibleValue => {
    if (prefFloor == null || r.implied_value == null || r.implied_value >= prefFloor) {
      return r
    }
    return {
      ...r,
      implied_value: prefFloor,
      multiple: principal > 0 ? prefFloor / principal : r.multiple,
    }
  }

  // Already converted → value rides the resulting shares (caller can price the
  // linked stake); we surface the recorded conversion if present.
  if (c.status === "converted") {
    const shares = num(c.conversion_shares)
    const price = num(c.conversion_price_per_share)
    const value = shares != null && price != null ? shares * price : null
    return {
      principal,
      implied_ownership_pct: null,
      implied_value: value,
      multiple: value != null && principal > 0 ? value / principal : null,
      basis: "converted",
    }
  }

  // Post-money SAFE with a cap → clean floor ownership = principal / cap.
  if (cap && cap > 0 && isPostMoney) {
    const ownership = principal / cap
    const valuation = ref && ref > 0 ? ref : cap
    const value = ownership * valuation
    return applyFloor({
      principal,
      implied_ownership_pct: ownership,
      implied_value: value,
      multiple: principal > 0 ? value / principal : null,
      basis: ref && ref > 0 ? "reference_valuation" : "cap",
    })
  }

  // Pre-money cap → approximate post-money as cap + this money in.
  if (cap && cap > 0) {
    const postMoney = cap + principal
    const ownership = principal / postMoney
    const valuation = ref && ref > 0 ? ref : postMoney
    const value = ownership * valuation
    return applyFloor({
      principal,
      implied_ownership_pct: ownership,
      implied_value: value,
      multiple: principal > 0 ? value / principal : null,
      basis: ref && ref > 0 ? "reference_valuation" : "cap",
    })
  }

  // Discount-only (no cap): can't imply ownership without a round price; the
  // honest floor is the principal (optionally uplifted by the discount).
  if (discount && discount > 0 && discount < 1) {
    const value = principal / (1 - discount)
    return applyFloor({
      principal,
      implied_ownership_pct: null,
      implied_value: value,
      multiple: principal > 0 ? value / principal : null,
      basis: "principal",
    })
  }

  // Nothing to imply from — show cost basis only.
  return applyFloor({
    principal,
    implied_ownership_pct: null,
    implied_value: principal || null,
    multiple: principal > 0 ? 1 : null,
    basis: principal > 0 ? "principal" : "unknown",
  })
}
