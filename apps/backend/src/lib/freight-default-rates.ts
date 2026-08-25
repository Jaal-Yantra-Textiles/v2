import type { QuoteFreightTier } from "./quote-freight-tiers"

/**
 * The freight numbers a store is provisioned with — in ONE place, because two
 * writers now depend on them (#1538).
 *
 * ## Why this file exists
 *
 * `create-store-with-defaults` chooses these amounts for a store it creates.
 * Every store that already exists was created before #1536, so its options
 * carry no `data` at all — and the backfill that repairs them must stamp the
 * SAME numbers, or a store repaired today and a store provisioned tomorrow
 * quote a buyer differently on the same lane.
 *
 * Restating the table in the backfill is exactly the drift `flat-fallback.ts`
 * warns about one level down: it wants the fallback to BE the intended tier
 * rather than a constant that happens to resemble one. A copy resembles until
 * somebody edits one of them.
 *
 * 🔑 These are editable placeholders, not researched rates. `#1538` asks
 * whether €35 is still the right fallback now that real lanes rate near €7.49.
 * When that is answered, this is the single file to change — and re-running the
 * backfill restamps the estate.
 *
 * Amounts are in the store's own price units (rupees for INR, euros for EUR),
 * matching what the carrier returns and what the flat companion is priced at.
 */

/**
 * The domestic flat fallback, in INR major units.
 *
 * One constant so the manual companion option's PRICE and the Shiprocket
 * option's `data.flat_fallback_amount` cannot drift apart — the fallback is
 * meant to be the manual provider's number, not a lookalike.
 */
export const DOMESTIC_FLAT_FALLBACK_AMOUNT = 200

export type IntlFlatRate = {
  /** The retail flat rate for the lane, in the currency's major units. */
  base: number
  /** Cart subtotal at or above which the lane is free. */
  freeAbove: number
}

/**
 * Retail international rates per currency. `usd` is the fallback for a currency
 * not listed here — a real number rather than nothing, because the alternative
 * used to be `DEFAULT_FLAT_FALLBACK` (200), which is an INR-shaped number and
 * charged **€200** on a EUR cart against an intended €35.
 *
 * 🔴 The USD fallback is a floor, not a licence to leave a currency out. Taking
 * the USD row VERBATIM is the same currency-blindness one rung down: an estate
 * selling in shekels would have been stamped `ils: 39` — ₪39 is about $13
 * against an intended $39, a third of the intended fallback and, being a
 * plausible-looking number, nothing to notice. Every currency the estate
 * actually sells in belongs in this table explicitly (#1538).
 *
 * The rows are not an FX conversion of one another — they are retail numbers,
 * rounded the way a price list rounds — but they do sit in one band: $31–41 at
 * the rates of 2026-08-24. A new row is placed inside that band and rounded,
 * NOT computed to the cent, so it reads as the placeholder it is.
 */
export const INTL_FLAT_RATES: Record<string, IntlFlatRate> = {
  usd: { base: 39, freeAbove: 350 },
  eur: { base: 35, freeAbove: 300 },
  gbp: { base: 30, freeAbove: 275 },
  aud: { base: 55, freeAbove: 450 },
  cad: { base: 50, freeAbove: 400 },
  inr: { base: 3200, freeAbove: 25000 },
  idr: { base: 550000, freeAbove: 5000000 },
  // ≈$40 base / ≈$351 free-above at USD→ILS 2.9922 (ECB via Frankfurter,
  // 2026-08-24). The handoff's proposed ₪145 was reasoned from a remembered
  // ~3.7 shekel; the live rate is 2.99, which would have put it at $48 —
  // a fifth above every other row in the table.
  ils: { base: 120, freeAbove: 1050 },
}

/** The rate for a currency, falling back to the USD row. Never undefined. */
export function intlFlatRateFor(currencyCode: string): IntlFlatRate {
  const key = String(currencyCode || "").trim().toLowerCase()
  return INTL_FLAT_RATES[key] ?? INTL_FLAT_RATES["usd"]
}

/**
 * PURE: the `data.flat_fallback_amounts` map for an international CALCULATED
 * option, built from the currencies the store actually sells in.
 *
 * 🔴 Keyed by CURRENCY, not by country. `calculated_amount` is returned in the
 * cart's currency whatever the destination is, so a country-keyed number has to
 * serve €35 and ₹3200 at once and cannot. That is the #1424/#1434
 * currency-blindness arriving through a different door.
 */
export function buildIntlFallbackByCurrency(
  currencies: Iterable<string>
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const raw of currencies) {
    const cur = String(raw || "").trim().toLowerCase()
    if (!cur) continue
    out[cur] = intlFlatRateFor(cur).base
  }
  return out
}

/** Upper bound of the light B2B tier, in grams. */
export const QUOTE_TIER_LIGHT_MAX_GRAMS = 5000

/**
 * The quote-only weight tiers (#1536).
 *
 * ⚠️ It is the FALLBACK, not the price: `pickFreightOption` takes a live
 * carrier rate whenever there is one. This is what stands behind the carrier,
 * and it is the number a buyer sees only when no courier would quote the lane.
 *
 * €59 / €100 was taken as the midpoint of a stated 50–69 range plus 100 above
 * 5 kg. #1538 item 3 asks for those numbers to be confirmed or replaced; this
 * is the single place to edit them.
 */
export const DEFAULT_QUOTE_FREIGHT_TIERS: QuoteFreightTier[] = [
  {
    max_weight_grams: QUOTE_TIER_LIGHT_MAX_GRAMS,
    amounts: {
      eur: 59,
      usd: 65,
      gbp: 52,
      aud: 95,
      cad: 88,
      inr: 5400,
      ils: 195,
      idr: 1150000,
    },
  },
  {
    max_weight_grams: null,
    amounts: {
      eur: 100,
      usd: 110,
      gbp: 88,
      aud: 160,
      cad: 150,
      inr: 9200,
      ils: 330,
      idr: 1950000,
    },
  },
]

/**
 * PURE: the price rows a quote-only tiered option needs to exist at all.
 *
 * The option is PRICED from `data.quote_weight_tiers` — Medusa's pricing
 * context carries no `weight` — but an option with no price row cannot be
 * created. The LIGHT tier is used deliberately: a misconfiguration that fell
 * back to these rows would then charge a parcel rate for a parcel rather than a
 * pallet rate for one.
 *
 * ⚠️ The `light["usd"]` fallback is currency-blind in the same way the
 * `INTL_FLAT_RATES` usd row is — an unlisted currency gets the USD FIGURE, so
 * a hypothetical `jpy` would carry a ¥65 row. It is inert today (every
 * currency the estate sells in is now priced above, and `resolveQuoteTierAmount`
 * returns null for one that is not, so the option is simply not offered), but
 * it is a lookalike number waiting for a new currency. Add the currency to the
 * tiers above rather than relying on this.
 */
export function quoteTierPriceRows(
  currencies: Iterable<string>
): Array<{ currency_code: string; amount: number }> {
  const light = DEFAULT_QUOTE_FREIGHT_TIERS[0].amounts as Record<string, number>
  const rows: Array<{ currency_code: string; amount: number }> = []
  for (const raw of currencies) {
    const cur = String(raw || "").trim().toLowerCase()
    if (!cur) continue
    rows.push({ currency_code: cur, amount: light[cur] ?? light["usd"] })
  }
  return rows
}
