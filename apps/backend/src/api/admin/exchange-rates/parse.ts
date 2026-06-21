/**
 * Pure helpers for the GET /admin/exchange-rates proxy route.
 * Kept side-effect-free so they can be unit tested without the network.
 */

/**
 * Parse a comma-separated `to` query param into a de-duplicated, upper-cased
 * list of currency codes, excluding the base currency and any blanks.
 */
export function parseTargetCurrencies(
  toRaw: string | undefined,
  base: string
): string[] {
  const baseUpper = (base || "").toUpperCase()
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of String(toRaw || "").split(",")) {
    const code = part.trim().toUpperCase()
    if (!code || code === baseUpper || seen.has(code)) continue
    seen.add(code)
    out.push(code)
  }
  return out
}

/**
 * Build the { base, rates } response payload from a list of resolved
 * [currency, rate] pairs (rates that failed to resolve are simply omitted).
 */
export function buildRatesResponse(
  base: string,
  pairs: Array<[string, number | null | undefined]>
): { base: string; rates: Record<string, number> } {
  const rates: Record<string, number> = {}
  for (const [code, rate] of pairs) {
    if (typeof rate === "number" && Number.isFinite(rate)) {
      rates[code.toUpperCase()] = rate
    }
  }
  return { base: base.toUpperCase(), rates }
}
