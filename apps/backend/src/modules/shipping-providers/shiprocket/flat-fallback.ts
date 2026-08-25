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
 *
 * ## 🔴 A bare number has no currency, and that is a bug not a simplification
 *
 * `calculated_amount` is returned in the CART's currency, whatever that is.
 * The lookups below were keyed only on destination COUNTRY, so one number had
 * to serve every currency the store sells in — and it cannot. On prod today
 * nothing is configured, so an unratable lane resolves to
 * `DEFAULT_FLAT_FALLBACK` (200), which means:
 *
 *   - a EUR cart to the Netherlands is charged **€200**, against an intended €35
 *   - an INR cart abroad is charged **₹200**, against an intended ₹3200
 *
 * Wrong by ~6× in one direction and ~16× in the other, silently, at checkout —
 * the currency-blindness of #1424/#1434 arriving through a different door. It
 * has been unreachable in practice only because international lanes were
 * falling to the flat MANUAL option; leaning on live international rates is
 * exactly what makes it reachable.
 *
 * So a per-currency map comes first. It is stamped onto the option's own `data`
 * from the SAME table that prices the manual companion, so the fallback IS the
 * intended tier rather than a constant that happens to resemble one.
 *
 * 🔑 When the currency is unknown the per-currency map is SKIPPED rather than
 * guessed at. Picking "the first entry" would be a coin-toss between €35 and
 * ₹3200, and a plausible wrong number is the thing this whole file exists to
 * stop.
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
 * Per-currency amounts stamped on a shipping option's `data`, keyed by ISO-4217
 * lower-case. The most specific answer available, and the only one that can be
 * right for a store selling in more than one currency.
 */
export type FlatFallbackByCurrency = Record<string, number>

/**
 * PURE: pick the fallback amount for a destination, or explain that none is
 * configured. A country-specific amount always beats the catch-all — a domestic
 * lane and a cross-border one are not the same order of magnitude, and one
 * number for both is wrong in one direction or the other.
 */
export function resolveFlatFallbackAmount(
  config: FlatFallbackConfig | undefined,
  destinationCountry: string | undefined,
  /**
   * The shipping option's own `data` blob. This is the FIRST place we look,
   * because it is the only per-store lever: `create-store-with-defaults` stamps
   * the same amount here that it prices the manual companion option at, so when
   * the carrier will not quote, the manual provider's number is literally what
   * takes over — not a constant that merely happens to match. An operator
   * editing the flat option's price can edit this alongside it.
   */
  optionData?: Record<string, unknown>,
  /**
   * The cart's currency. `calculated_amount` is denominated in it, so it is
   * what decides which figure is even meaningful. Optional because not every
   * caller can supply it — and when it is absent the per-currency map is
   * skipped rather than guessed.
   */
  currencyCode?: string | null
): { amount?: number; reason?: string } {
  /**
   * 🔴 Per-currency FIRST. It is the only lookup here that can be correct for a
   * store selling in several currencies, and the option-level scalar below it
   * is by construction a single-currency answer.
   */
  const currency = String(currencyCode || "").trim().toLowerCase()
  const byCurrency = (optionData as any)?.flat_fallback_amounts as
    | FlatFallbackByCurrency
    | undefined
  if (currency && byCurrency && typeof byCurrency === "object") {
    for (const [key, value] of Object.entries(byCurrency)) {
      if (String(key).trim().toLowerCase() !== currency) continue
      // A configured 0 is a real answer — "this lane is free". Only ABSENCE
      // falls through, hence the validity check rather than truthiness.
      if (Number.isFinite(Number(value))) return { amount: Number(value) }
    }
  }

  const fromOption = Number((optionData as any)?.flat_fallback_amount)
  if (Number.isFinite(fromOption)) return { amount: fromOption }

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
    reason:
      `no flat fallback is configured for ${country}` +
      (currency ? ` in ${currency.toUpperCase()}` : "") +
      `; used the default ${DEFAULT_FLAT_FALLBACK}, which is an INR-shaped ` +
      `number and is almost certainly wrong in any other currency`,
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
