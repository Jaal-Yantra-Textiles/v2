import { FxProvider, FxProviderResult } from "./types"

/**
 * open.er-api.com — free, no API key, USD-based.
 *
 * Sample response:
 *   {
 *     "result": "success",
 *     "provider": "https://www.exchangerate-api.com",
 *     "base_code": "USD",
 *     "time_last_update_unix": 1742428801,
 *     "rates": { "USD": 1, "AED": 3.6725, "AFN": 70.5, ... }
 *   }
 *
 * Limits: 1 request per ~10 min recommended; daily refresh is well
 * within bounds. No auth.
 */
export class OpenErApiProvider implements FxProvider {
  private readonly endpoint: string

  constructor(opts: { endpoint?: string } = {}) {
    this.endpoint = opts.endpoint ?? "https://open.er-api.com/v6/latest/USD"
  }

  async fetchRates(): Promise<FxProviderResult> {
    const res = await fetch(this.endpoint, {
      headers: { Accept: "application/json" },
    })
    if (!res.ok) {
      throw new Error(
        `OpenErApiProvider: HTTP ${res.status} from ${this.endpoint}`
      )
    }
    const body = (await res.json()) as {
      result?: string
      base_code?: string
      time_last_update_unix?: number
      rates?: Record<string, number>
      "error-type"?: string
    }

    if (body.result !== "success" || !body.rates || !body.base_code) {
      throw new Error(
        `OpenErApiProvider: unexpected response shape: ${
          body["error-type"] ?? JSON.stringify(body).slice(0, 200)
        }`
      )
    }

    return {
      base_currency: body.base_code.toLowerCase(),
      fetched_at: body.time_last_update_unix
        ? new Date(body.time_last_update_unix * 1000)
        : new Date(),
      source: "open.er-api.com",
      // Lowercase the keys to match Medusa's currency_code convention.
      rates: Object.fromEntries(
        Object.entries(body.rates).map(([code, rate]) => [
          code.toLowerCase(),
          rate,
        ])
      ),
    }
  }
}
