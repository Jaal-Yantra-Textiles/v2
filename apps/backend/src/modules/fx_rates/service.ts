import { MedusaService, MedusaError } from "@medusajs/framework/utils"
import FxRate from "./models/fx-rate"
import FxPriceMeta from "./models/fx-price-meta"
import { FxProvider, FxProviderResult } from "./providers/types"
import { OpenErApiProvider } from "./providers/open-er-api-provider"

class FxRatesService extends MedusaService({ FxRate, FxPriceMeta }) {
  /**
   * Provider used for `refreshRatesFromProvider()`. Swappable via
   * `setProvider()` for tests / future paid providers; default is
   * open.er-api.com.
   *
   * Note: we intentionally don't take the provider as a constructor
   * arg because Medusa's MedusaService factory wires the container
   * automatically; adding a custom constructor breaks the manager
   * context binding. A simple setter keeps that wiring intact while
   * letting tests + future config swap the provider.
   */
  protected provider: FxProvider = new OpenErApiProvider()

  setProvider(p: FxProvider): void {
    this.provider = p
  }

  /**
   * Look up the current rate from `from` → `to`.
   *
   * Same currency → returns 1.
   * Direct row present → returns the stored rate.
   * Otherwise → computes via the cached base currency
   *   from → base → to  ==  rate(base→to) / rate(base→from)
   *
   * Throws if no path exists in cache (caller can handle missing
   * coverage).
   */
  async getRate(from: string, to: string): Promise<number> {
    const fromCode = from.toLowerCase()
    const toCode = to.toLowerCase()
    if (fromCode === toCode) return 1

    const direct = await this.listFxRates({
      base_currency: fromCode,
      quote_currency: toCode,
    })
    if (direct?.[0]) {
      return Number(direct[0].rate)
    }

    // Try via inverse — if we have to→from, return 1/rate.
    const inverse = await this.listFxRates({
      base_currency: toCode,
      quote_currency: fromCode,
    })
    if (inverse?.[0]) {
      const r = Number(inverse[0].rate)
      if (r > 0) return 1 / r
    }

    // Compute cross-rate via the most common base currency in the cache.
    // For open.er-api.com that's USD. We pick whatever base appears
    // most often so the service stays provider-agnostic.
    const all = await this.listFxRates({})
    if (!all.length) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `FxRatesService.getRate: no rates cached. Run seed-initial-fx-rates or refreshRatesFromProvider().`
      )
    }
    const baseCounts = new Map<string, number>()
    for (const r of all) {
      baseCounts.set(r.base_currency, (baseCounts.get(r.base_currency) ?? 0) + 1)
    }
    const candidateBases = Array.from(baseCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([b]) => b)

    for (const intermediate of candidateBases) {
      if (intermediate === fromCode || intermediate === toCode) continue
      const baseToFrom = all.find(
        (r) => r.base_currency === intermediate && r.quote_currency === fromCode
      )
      const baseToTo = all.find(
        (r) => r.base_currency === intermediate && r.quote_currency === toCode
      )
      if (baseToFrom && baseToTo) {
        const a = Number(baseToFrom.rate)
        const b = Number(baseToTo.rate)
        if (a > 0) return b / a
      }
    }

    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `FxRatesService.getRate: no path from ${fromCode} to ${toCode}`
    )
  }

  /**
   * `getRate`, but a cache that is missing the pair or too old triggers ONE
   * live provider fetch and a retry.
   *
   * `getRate` alone answers off a cache that is only as fresh as whoever last
   * refreshed it, and it cannot tell "this pair does not exist" from "nobody
   * has refreshed in a month" (#1512). For money that is about to be written —
   * converting a payout line — reading a stale rate silently is the failure
   * mode worth spending a network call to avoid. A remembered rate was once
   * 24% wrong (#1538).
   *
   * 🔴 At most ONE refresh, ever, per service instance per concurrent burst.
   * Unbounded FX fetching has OOM-killed production twice (#1368), so the
   * in-flight promise is shared: N lines converting at once trigger one fetch,
   * not N. A refresh that has already happened is not repeated for a pair the
   * provider simply does not carry — otherwise every unknown currency becomes
   * a fresh HTTP call.
   *
   * ⚠️ Falls back to the cached value if the provider fetch fails but the cache
   * could answer. A stale rate beats no payout; a MISSING rate still throws,
   * because `convertAmount` must never see a rate it can treat as 1.
   */
  async getRateLive(
    from: string,
    to: string,
    options?: { maxAgeMs?: number }
  ): Promise<number> {
    const fromCode = from.toLowerCase()
    const toCode = to.toLowerCase()
    if (fromCode === toCode) return 1

    // 24h by default: rates move slowly enough that a day-old figure is fine,
    // and often enough that a month-old one is not.
    const maxAgeMs = options?.maxAgeMs ?? 24 * 60 * 60 * 1000

    let cached: number | null = null
    try {
      cached = await this.getRate(fromCode, toCode)
    } catch {
      cached = null
    }

    const lastFetchedAt = await this.getLastFetchedAt()
    const isStale =
      !lastFetchedAt || Date.now() - lastFetchedAt.getTime() > maxAgeMs

    if (cached !== null && !isStale) return cached

    try {
      await this.refreshOnce()
    } catch (e) {
      // Provider unreachable. A stale cached rate is still better than
      // refusing, but nothing is better than a wrong one.
      if (cached !== null) return cached
      throw e
    }

    return this.getRate(fromCode, toCode)
  }

  /**
   * Shared in-flight refresh, so concurrent callers cause one provider fetch
   * rather than one each. See the fanout note on `getRateLive`.
   */
  protected refreshInFlight: Promise<unknown> | null = null

  protected async refreshOnce(): Promise<unknown> {
    if (!this.refreshInFlight) {
      this.refreshInFlight = this.refreshRatesFromProvider().finally(() => {
        this.refreshInFlight = null
      })
    }
    return this.refreshInFlight
  }

  /**
   * Fetch fresh rates from the configured provider and upsert into the
   * fx_rate table. Returns counts of inserts/updates.
   */
  async refreshRatesFromProvider(): Promise<{
    base_currency: string
    upserted: number
    fetched_at: Date
    source: string
  }> {
    const result = await this.provider.fetchRates()
    return this.applyProviderResult(result)
  }

  /**
   * Lower-level: write a provider result into the cache. Useful for
   * tests (skip the real HTTP fetch) and for scripts that load rates
   * from a file / fixture.
   */
  async applyProviderResult(result: FxProviderResult): Promise<{
    base_currency: string
    upserted: number
    fetched_at: Date
    source: string
  }> {
    const base = result.base_currency.toLowerCase()
    const rows = Object.entries(result.rates).map(([quote, rate]) => ({
      base_currency: base,
      quote_currency: quote.toLowerCase(),
      rate,
      fetched_at: result.fetched_at,
      source: result.source,
    }))

    let upserted = 0
    for (const row of rows) {
      const existing = await this.listFxRates({
        base_currency: row.base_currency,
        quote_currency: row.quote_currency,
      })
      if (existing?.[0]) {
        await this.updateFxRates({
          id: existing[0].id,
          rate: row.rate,
          fetched_at: row.fetched_at,
          source: row.source,
        })
      } else {
        await this.createFxRates(row)
      }
      upserted++
    }

    return {
      base_currency: base,
      upserted,
      fetched_at: result.fetched_at,
      source: result.source,
    }
  }

  /**
   * Last-refresh timestamp across all rates. Returns null if no rates
   * are cached. Useful for "is FX cache stale?" checks.
   */
  async getLastFetchedAt(): Promise<Date | null> {
    const all = await this.listFxRates({})
    if (!all.length) return null
    let max: Date | null = null
    for (const r of all) {
      const d = new Date(r.fetched_at)
      if (!max || d > max) max = d
    }
    return max
  }
}

export default FxRatesService
