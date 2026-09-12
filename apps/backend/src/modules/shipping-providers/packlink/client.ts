/**
 * Packlink PRO API client — the piece that quotes a lane our Indian carrier
 * cannot.
 *
 * WHY THIS EXISTS. Shiprocket originates in India; EasyPost's account here
 * originates only in the US or Canada (verified 2026-09-12: every carrier on
 * that account answered "from_address.country is required to be US", while the
 * identical payload from a US origin returned 8 rates). So an EU partner —
 * Le Ciricotte, Greve in Chianti — had no way to quote at all, and its
 * international shipping was hand-priced flat. Packlink quotes from Italy.
 */
import {
  normalisePostcodeForPacklink,
} from "./postcode"
import type { PacklinkService } from "./rate-select"

export type PacklinkOptions = {
  /** PRO API key. Belongs in SSM, never in .env or a config literal. */
  api_key?: string
  base_url?: string
  /** Packlink's `source`; "PRO" for the business platform. */
  source?: string
  timeout_ms?: number
  /** Injected in tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch
}

export type PacklinkRateQuery = {
  from_country: string
  from_zip: string
  to_country: string
  to_zip: string
  weight_kg: number
  length_cm: number
  width_cm: number
  height_cm: number
}

const DEFAULT_BASE = "https://api.packlink.com"

/**
 * Build the query exactly as the API wants it.
 *
 * Exported for testing: the bracket notation (`packages[0][weight]`) and the
 * postcode normalisation are the two things that decide between 200 and an
 * unexplained 400, and neither is visible from the response.
 */
export const buildRateQuery = (
  q: PacklinkRateQuery,
  source = "PRO"
): URLSearchParams => {
  const p = new URLSearchParams()
  p.set("from[country]", q.from_country.toUpperCase())
  p.set("from[zip]", normalisePostcodeForPacklink(q.from_country, q.from_zip))
  p.set("to[country]", q.to_country.toUpperCase())
  p.set("to[zip]", normalisePostcodeForPacklink(q.to_country, q.to_zip))
  p.set("packages[0][weight]", String(q.weight_kg))
  p.set("packages[0][length]", String(q.length_cm))
  p.set("packages[0][width]", String(q.width_cm))
  p.set("packages[0][height]", String(q.height_cm))
  if (source) p.set("source", source)
  return p
}

export class PacklinkClient {
  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly source: string
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof fetch

  constructor(options: PacklinkOptions = {}) {
    this.apiKey = options.api_key ?? process.env.PACKLINK_API_KEY ?? ""
    this.baseUrl = (options.base_url ?? DEFAULT_BASE).replace(/\/+$/, "")
    this.source = options.source ?? "PRO"
    this.timeoutMs = options.timeout_ms ?? 10_000
    this.fetchImpl = options.fetchImpl ?? ((globalThis as any).fetch as typeof fetch)
  }

  get configured(): boolean {
    return Boolean(this.apiKey)
  }

  /**
   * Services (and prices) for a lane.
   *
   * Throws on a non-2xx rather than returning [] — 🔑 an empty list and a
   * refusal are different answers, and collapsing them is how a 400 becomes a
   * silent "no carriers serve this route". The caller decides what to do with
   * each; it cannot decide if it cannot tell them apart.
   */
  async getServices(q: PacklinkRateQuery): Promise<PacklinkService[]> {
    if (!this.configured) {
      throw new Error("Packlink is not configured: no api_key / PACKLINK_API_KEY")
    }
    const url = `${this.baseUrl}/v1/services?${buildRateQuery(q, this.source).toString()}`

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const res = await this.fetchImpl(url, {
        method: "GET",
        headers: { Authorization: this.apiKey, Accept: "application/json" },
        signal: controller.signal,
      })
      const text = await res.text()
      if (!res.ok) {
        // Packlink says only {"messages":[{"message":"Bad Request"}]} for a bad
        // postcode, a bad package AND an unserved lane. Carry the status and
        // the lane so the log can at least say WHICH request failed.
        throw new Error(
          `Packlink ${res.status} for ${q.from_country} ${q.from_zip} -> ${q.to_country} ${q.to_zip}: ${text.slice(0, 200)}`
        )
      }
      const parsed = text ? JSON.parse(text) : []
      return Array.isArray(parsed) ? (parsed as PacklinkService[]) : []
    } finally {
      clearTimeout(timer)
    }
  }
}
