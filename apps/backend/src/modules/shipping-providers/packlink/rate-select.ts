/**
 * Which of Packlink's services to quote, and for how much.
 *
 * Packlink returns every service it can sell for a lane — 8 for Italy→GB on
 * 2026-09-12, from Poste Italiane at €18.19 to Fedex International Priority at
 * €116.69. Six-fold spread. Picking one is a commercial decision, so it is a
 * configured policy here rather than a hardcoded `[0]`.
 *
 * 🔴 Never `services[0]`. Packlink does not document an ordering, and an
 * unordered pick over a 6× price spread is the same row-order lottery that
 * `stores[0]` and `take: 1` have already cost this codebase twice. Every
 * selection below sorts explicitly.
 */

export type PacklinkService = {
  id?: number | string
  name?: string
  carrier_name?: string
  currency?: string
  transit_time?: string
  base_price?: string | number
  price?: { total_price?: string | number; base_price?: string | number }
}

export type RateSelectionPolicy = {
  /** "cheapest" (default) or "fastest" by advertised transit days. */
  prefer?: "cheapest" | "fastest"
  /** Only consider these carriers, case-insensitive. Empty/absent = all. */
  carriers?: string[]
  /** Multiplied onto the carrier price, e.g. 1.2 for +20%. Default 1 (at cost). */
  margin?: number
  /** Never quote below this, in the carrier's currency. */
  minimum?: number
}

/** The price Packlink actually charges, in EUR. `null` when unreadable. */
export const servicePrice = (s: PacklinkService): number | null => {
  const raw = s?.price?.total_price ?? s?.price?.base_price ?? s?.base_price
  if (raw === undefined || raw === null || raw === "") return null
  const n = Number(raw)
  // 🔑 `Number("")` is 0 and `Number(null)` is 0 — both would read as a FREE
  // shipment. Guarded above, and NaN is rejected here rather than propagating.
  return Number.isFinite(n) ? n : null
}

/** Advertised transit in days, e.g. "3 DAYS" -> 3. `null` when unstated. */
export const transitDays = (s: PacklinkService): number | null => {
  const m = /(\d+)/.exec(String(s?.transit_time ?? ""))
  return m ? Number(m[1]) : null
}

/**
 * Choose one service, deterministically.
 *
 * Returns `null` when nothing is quotable — which is a REFUSAL, not a price of
 * zero. The caller must fall back rather than quote 0.
 */
export const selectService = (
  services: PacklinkService[] | null | undefined,
  policy: RateSelectionPolicy = {}
): PacklinkService | null => {
  const wanted = (policy.carriers ?? [])
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean)

  const usable = (services ?? []).filter((s) => {
    if (servicePrice(s) === null) return false
    if (!wanted.length) return true
    return wanted.includes(String(s.carrier_name ?? "").trim().toLowerCase())
  })
  if (!usable.length) return null

  const byPrice = (a: PacklinkService, b: PacklinkService) =>
    (servicePrice(a) as number) - (servicePrice(b) as number)

  if (policy.prefer === "fastest") {
    return [...usable].sort((a, b) => {
      const da = transitDays(a)
      const db = transitDays(b)
      // A service that does not state its transit time must not win "fastest"
      // by virtue of being unknown — it sorts last, then price breaks the tie.
      if (da === null && db === null) return byPrice(a, b)
      if (da === null) return 1
      if (db === null) return -1
      return da - db || byPrice(a, b)
    })[0]
  }

  return [...usable].sort(byPrice)[0]
}

/** Apply the configured margin and floor to a carrier price. */
export const applyPolicyToPrice = (
  carrierPrice: number,
  policy: RateSelectionPolicy = {}
): number => {
  const margin =
    typeof policy.margin === "number" && Number.isFinite(policy.margin) && policy.margin > 0
      ? policy.margin
      : 1
  const withMargin = carrierPrice * margin
  const floor =
    typeof policy.minimum === "number" && Number.isFinite(policy.minimum)
      ? policy.minimum
      : 0
  return Math.max(withMargin, floor)
}
