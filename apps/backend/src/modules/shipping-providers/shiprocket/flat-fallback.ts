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
 * ## Why an unconfigured fallback THROWS
 *
 * Defaulting the default (to 0, or to some invented amount) reintroduces
 * exactly the silent-zero bug this replaces. If nobody has said what an
 * unquotable Indian lane costs, we do not know — and saying so loudly at
 * checkout is recoverable, whereas shipping thousands of free parcels is not.
 *
 * So: configure `flat_fallback_amounts` (or at minimum `flat_fallback_amount`)
 * and the fallback is silent and cheap; leave it unset and the first carrier
 * outage tells you, once, in an error naming the country.
 *
 * Amounts are MINOR units (paise for INR), matching how Medusa carries money.
 */

export type FlatFallbackConfig = {
  /** Per-destination-country minor-unit amounts, keyed by ISO2 (case-insensitive). */
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

  return {
    reason: `no flat fallback rate is configured for ${country}. Set \`flat_fallback_amounts\` (or \`flat_fallback_amount\`) on the Shiprocket provider so an unquotable lane has a price instead of silently costing nothing.`,
  }
}

/**
 * Read the fallback config off env, for the medusa-config provider block.
 *
 * `SHIPROCKET_FLAT_FALLBACK_AMOUNTS` is `IN=9900,US=249000` — ISO2=minor units,
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
