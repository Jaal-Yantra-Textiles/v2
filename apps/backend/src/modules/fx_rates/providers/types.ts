/**
 * Provider-agnostic FX fetcher interface.
 *
 * `fetchRates()` returns rates against a single base currency (whichever
 * the provider supplies natively — USD for open.er-api.com, configurable
 * for paid providers). Cross-rates are derived by the service, not by
 * the provider.
 *
 * Implementations live alongside this file. Swapping providers is a
 * matter of changing the import in the service or via env-var-based
 * selection.
 */

export type FxProviderResult = {
  base_currency: string
  fetched_at: Date
  source: string
  /** quote_currency → rate (1 base = N quote) */
  rates: Record<string, number>
}

export interface FxProvider {
  /**
   * Fetch the latest rates from the provider. Throws on network or
   * parse errors — caller should catch and decide whether to fall back
   * to cached values.
   */
  fetchRates(): Promise<FxProviderResult>
}
