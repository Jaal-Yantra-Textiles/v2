/**
 * Live FX, one implementation (#1439 S7).
 *
 * Extracted verbatim from `workflows/designs/create-draft-order-from-designs.ts`,
 * which is where it was born and where it stayed exported. A second caller
 * — the B2B quote line override — must not reach into a designs workflow to
 * convert a currency: that import would make the quote path depend on an
 * unrelated workflow's module graph, and the next caller would copy the
 * function instead.
 *
 * Rates come from the Frankfurter API (ECB data, free, no key) and update once
 * per business day, so an in-memory hour of caching costs nothing in accuracy
 * and takes the network off the hot path.
 *
 * 🔴 This THROWS on failure, deliberately, and callers must not swallow it.
 * A conversion that silently falls back to rate 1 does not fail — it quotes a
 * buyer 45,000 INR as 45,000 USD. Where an unavailable rate should not block
 * the work, the caller's job is to refuse the OPERATION, not to invent a
 * number. (Contrast `calculatePrice` on a shipping provider, where a defined
 * logged fallback is right because a throw blanks the whole options list.)
 */

type FrankfurterResponse = {
  base: string
  date: string
  rates: Record<string, number>
}

const frankfurterCache = new Map<string, { rate: number; fetchedAt: number }>()
const CACHE_TTL_MS = 60 * 60 * 1000

export async function fetchExchangeRate(
  from: string,
  to: string
): Promise<number> {
  const fromUpper = from.toUpperCase()
  const toUpper = to.toUpperCase()

  if (fromUpper === toUpper) return 1

  const cacheKey = `${fromUpper}_${toUpper}`
  const cached = frankfurterCache.get(cacheKey)
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.rate
  }

  const url = `https://api.frankfurter.app/latest?from=${fromUpper}&to=${toUpper}`
  const res = await fetch(url)

  if (!res.ok) {
    throw new Error(
      `Failed to fetch exchange rate ${fromUpper}→${toUpper}: ${res.status} ${res.statusText}`
    )
  }

  const data: FrankfurterResponse = await res.json()
  const rate = data.rates[toUpper]

  if (rate == null) {
    throw new Error(`Exchange rate not available for ${fromUpper}→${toUpper}`)
  }

  frankfurterCache.set(cacheKey, { rate, fetchedAt: Date.now() })
  return rate
}

/** PURE. Two decimals, because a price is money and not a float. */
export function applyRate(amount: number, rate: number): number {
  return Math.round(amount * rate * 100) / 100
}

/** Test seam: the cache is process-global and would leak between cases. */
export function __clearExchangeRateCache(): void {
  frankfurterCache.clear()
}
