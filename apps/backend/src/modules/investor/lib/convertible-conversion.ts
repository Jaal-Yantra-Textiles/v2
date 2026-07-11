/**
 * Compute the conversion of an outstanding convertible (SAFE / note / loan) into
 * equity or CCPS shares (#969 follow-up). Pure — no I/O — so it's unit-testable
 * and shared by the admin convert route.
 *
 * The conversion price is the price PER SHARE at which the invested principal
 * buys shares. A SAFE/note holder gets the most favourable of:
 *   - cap price      = valuation_cap / fully_diluted_shares  (the cap protects them)
 *   - discount price = round_price × (1 − discount_rate)     (the discount rewards them)
 * whichever is LOWER (more shares for the money). Falls back to the round price,
 * then to any explicitly supplied price.
 *
 * Share count = principal / conversion_price. Callers may override with an
 * explicit `shares` (e.g. a CCPS that converts by a fixed ratio, not by price).
 */
export type ConversionInput = {
  principal_amount?: number | string | null
  valuation_cap?: number | string | null
  discount_rate?: number | null
  // The CCPS-only path can convert by ratio off pre-issued shares instead of price.
  num_shares?: number | string | null
  conversion_ratio?: number | null
}

export type ConversionTerms = {
  // The priced round the convertible converts at.
  round_price_per_share?: number | string | null
  fully_diluted_shares?: number | string | null
  // Explicit overrides (win over the derived values when provided).
  shares?: number | string | null
  price_per_share?: number | string | null
}

export type ConversionResult = {
  conversion_price_per_share: number | null
  conversion_shares: number | null
  basis: "cap" | "discount" | "round_price" | "ratio" | "explicit" | "unknown"
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null
  const n = typeof v === "string" ? parseFloat(v) : (v as number)
  return Number.isFinite(n) ? n : null
}

export function computeConversion(
  c: ConversionInput,
  terms: ConversionTerms = {}
): ConversionResult {
  const principal = num(c.principal_amount) ?? 0
  const cap = num(c.valuation_cap)
  const discount = num(c.discount_rate)
  const roundPrice = num(terms.round_price_per_share)
  const fds = num(terms.fully_diluted_shares)

  // Explicit overrides win outright.
  const explicitPrice = num(terms.price_per_share)
  const explicitShares = num(terms.shares)
  if (explicitShares != null && explicitShares > 0) {
    const price =
      explicitPrice ?? (principal > 0 ? principal / explicitShares : null)
    return {
      conversion_price_per_share: price,
      conversion_shares: explicitShares,
      basis: "explicit",
    }
  }

  // Candidate per-share prices, cheapest first (cheaper → more shares → better
  // for the holder). A CCPS/note that only carries a ratio and pre-issued shares
  // converts by ratio when no priced round is supplied.
  const capPrice = cap && cap > 0 && fds && fds > 0 ? cap / fds : null
  const discountPrice =
    roundPrice && roundPrice > 0 && discount && discount > 0 && discount < 1
      ? roundPrice * (1 - discount)
      : null

  const candidates: Array<{ price: number; basis: ConversionResult["basis"] }> = []
  if (capPrice != null) candidates.push({ price: capPrice, basis: "cap" })
  if (discountPrice != null) candidates.push({ price: discountPrice, basis: "discount" })
  if (roundPrice != null && roundPrice > 0)
    candidates.push({ price: roundPrice, basis: "round_price" })

  if (candidates.length) {
    const best = candidates.reduce((a, b) => (b.price < a.price ? b : a))
    const shares = best.price > 0 && principal > 0 ? principal / best.price : null
    return {
      conversion_price_per_share: best.price,
      conversion_shares: shares != null ? Math.round(shares) : null,
      basis: best.basis,
    }
  }

  // No priced round → convert pre-issued shares by ratio (CCPS end-state → common).
  const preShares = num(c.num_shares)
  if (preShares != null && preShares > 0) {
    const ratio = num(c.conversion_ratio) ?? 1
    const shares = Math.round(preShares * ratio)
    return {
      conversion_price_per_share: shares > 0 && principal > 0 ? principal / shares : null,
      conversion_shares: shares,
      basis: "ratio",
    }
  }

  return { conversion_price_per_share: null, conversion_shares: null, basis: "unknown" }
}
