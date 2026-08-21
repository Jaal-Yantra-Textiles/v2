/**
 * The flat rate a Shiprocket lane falls back to when the carrier will not quote
 * it (#1417).
 *
 * ## Why a fallback at all
 *
 * `calculatePrice` used to answer an unquotable lane with `0`. A zero is
 * indistinguishable from a genuinely free lane, so nothing downstream — not the
 * cart, not the order, not a report — can tell a carrier outage from a
 * promotion. It shipped free international freight for as long as it existed.
 *
 * The two honest answers are "refuse" and "charge a known flat rate". A refusal
 * blocks checkout on a carrier hiccup, so this takes the flat rate: the buyer
 * always gets a number, and it is a number somebody chose.
 *
 * ## Why an unconfigured fallback does NOT throw
 *
 * An earlier cut of this threw when nothing was configured, on the reasoning
 * that a defaulted default reintroduces the silent zero. Refuting fact: NO
 * provider in this codebase throws from `calculatePrice` — Delhivery, live in
 * production today, returns 0 on both a bad pincode and a carrier error. So a
 * throw here has no precedent, and if it propagates it takes the WHOLE shipping
 * options listing with it, leaving the buyer no options at all — including the
 * manual flat one that exists precisely for this case. That is strictly worse
 * than what it replaced.
 *
 * `DEFAULT_FLAT_FALLBACK` is the compromise: a real, non-zero, LOGGED amount
 * matching the flat companion option `create-store-with-defaults` provisions, so
 * behaviour is defined with no configuration at all. It is not the silent zero —
 * it is distinguishable from a free lane and it announces itself in the log.
 * Override per-country when the real numbers are known.
 *
 * Amounts are in the store's own price units (rupees for INR), matching what
 * the carrier returns and what the flat companion option is priced in.
 */

/** Matches the flat companion option provisioned by create-store-with-defaults. */
export const DEFAULT_FLAT_FALLBACK = 200

export type FlatFallbackConfig = {
  /** Per-destination-country amounts in store price units, keyed by ISO2 (case-insensitive). */
  flat_fallback_amounts?: Record<string, number>
  /** Applied when no country-specific amount is configured. */
  flat_fallback_amount?: number
}

/**
 * PURE: pick the fallback amount for a destination, or explain that none is
 * configured. A country-specific amount always beats the catch-all — a domestic
 * lane and a cross-border one are not the same order of magnitude, and one
 * number for both is wrong in one direction or the other.
 */
export function resolveFlatFallbackAmount(
  config: FlatFallbackConfig | undefined,
  destinationCountry: string | undefined
): { amount?: number; reason?: string } {
  const country = String(destinationCountry || "IN").toUpperCase()

  const byCountry = config?.flat_fallback_amounts
  if (byCountry) {
    for (const [key, value] of Object.entries(byCountry)) {
      if (String(key).toUpperCase() !== country) continue
      // A configured 0 is a real answer — "this lane is free" — and must be
      // honoured. Only ABSENCE falls through, which is why this checks the
      // number's validity rather than its truthiness.
      if (Number.isFinite(Number(value))) return { amount: Number(value) }
    }
  }

  const fallback = config?.flat_fallback_amount
  if (Number.isFinite(Number(fallback))) return { amount: Number(fallback) }

  // Defined, non-zero and logged by the caller. See the header for why this is
  // a default rather than a refusal.
  return {
    amount: DEFAULT_FLAT_FALLBACK,
    reason: `no flat fallback is configured for ${country}; used the default ${DEFAULT_FLAT_FALLBACK}`,
  }
}

/**
 * Read the fallback config off env, for the medusa-config provider block.
 *
 * `SHIPROCKET_FLAT_FALLBACK_AMOUNTS` is `IN=200,US=3200` — ISO2=amount in store price units,
 * comma-separated. Malformed pairs are DROPPED rather than coerced: a typo that
 * silently became 0 would be the original bug with extra steps, and a dropped
 * pair surfaces as the loud "no flat fallback configured" error.
 */
export function parseFlatFallbackAmounts(
  raw?: string
): Record<string, number> | undefined {
  if (!raw?.trim()) return undefined

  const out: Record<string, number> = {}
  for (const pair of raw.split(",")) {
    const [country, amount] = pair.split("=").map((s) => s?.trim())
    if (!country || !amount) continue
    const parsed = Number(amount)
    if (!Number.isFinite(parsed) || parsed < 0) continue
    out[country.toUpperCase()] = parsed
  }

  return Object.keys(out).length ? out : undefined
}
