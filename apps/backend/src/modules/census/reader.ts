import { brotliDecompressSync } from "node:zlib"

// k-anonymity: aggregate cells below this are suppressed (null) for public output.
const MIN_CELL = 5
// safety cap on a full-record scan (the live public core has no secondary index
// yet — see listWeavers). Bounds worst-case work; we flag when a scan is capped
// rather than silently truncating.
const MAX_SCAN = 50_000

// Minimal shape of the Hyperbee handle we depend on. The real instance is created
// in the P2P loader (dynamic native import) and injected via setBee — this file
// stays free of the native hypercore stack so it type-checks and runs anywhere.
type Sub = {
  get(key: string): Promise<{ value: Buffer } | null>
  createReadStream(range?: { gte?: string; gt?: string; lte?: string; lt?: string }): AsyncIterable<{ key: string; value: any }>
}
type Bee = { sub(prefix: string, opts?: Record<string, unknown>): Sub }

export type WeaverFilters = Record<string, string | number | boolean>
export type ListOptions = { limit?: number; offset?: number; after?: string | number }
export type Stats = Record<string, Record<string, number | null>>

// Zero-pad census ids so the secondary index sorts lexicographically = numerically
// (ids are < 10^10). MUST match the seeder/backfill's padding width.
const ID_PAD = 10
const padId = (id: string | number) => String(id).padStart(ID_PAD, "0")

/**
 * Read-only query surface over the handloom census PUBLIC core (masked, PII-free
 * records + pre-computed aggregates written by the P2P seeder). Held as a module
 * singleton; the loader replicates the core over Hyperswarm and calls setBee once
 * the Hyperbee is open. Until then `ready` is false and methods throw a clear error.
 */
export class CensusReader {
  private bee: Bee | null = null
  private proxyUrl: string | null = null

  /** Embedded mode: the loader replicated the core and hands us the live Hyperbee. */
  setBee(bee: Bee) {
    this.bee = bee
  }

  /**
   * Proxy mode: instead of peering in-process, read from a standalone reader
   * service over HTTP (e.g. a Render edge proxy that holds the swarm peer). Lets
   * prod serve census data without the native hypercore stack or Hyperswarm
   * connectivity inside Fargate — set CENSUS_READER_URL and we just fetch.
   */
  setProxy(url: string) {
    this.proxyUrl = url.replace(/\/$/, "")
  }

  get ready(): boolean {
    return this.bee !== null || this.proxyUrl !== null
  }

  private async proxyGet<T>(path: string): Promise<T> {
    const res = await fetch(`${this.proxyUrl}${path}`, { headers: { accept: "application/json" } })
    if (!res.ok) throw new Error(`census reader proxy ${path} → HTTP ${res.status}`)
    return (await res.json()) as T
  }

  private requireBee(): Bee {
    if (!this.bee) {
      throw new Error(
        "census P2P reader not connected — set CENSUS_P2P_ENABLED=true (+ CENSUS_PUBLIC_CORE_KEY) and allow a moment for the core to replicate"
      )
    }
    return this.bee
  }

  private decode(buf: Buffer): Record<string, any> {
    return JSON.parse(brotliDecompressSync(buf).toString())
  }

  /** Resolve one masked weaver record by census_id, or null if unknown. */
  async retrieveWeaver(id: string | number): Promise<Record<string, any> | null> {
    if (this.proxyUrl) {
      const { weaver } = await this.proxyGet<{ weaver: Record<string, any> | null }>(
        `/census/weavers/${encodeURIComponent(String(id))}`
      )
      return weaver ?? null
    }
    const rec = this.requireBee().sub("rec", { valueEncoding: "binary" })
    const node = await rec.get(String(id))
    return node ? this.decode(node.value) : null
  }

  /**
   * Public analytics feed: read the pre-computed `agg/*` cells with k-anonymity
   * suppression. O(#aggregate cells) — cheap and scale-safe (never a per-record
   * scan). Mirrors the seeder's aggregate semantics so counts line up exactly.
   */
  async getStats({ minCell = MIN_CELL }: { minCell?: number } = {}): Promise<Stats> {
    if (this.proxyUrl) {
      const { stats } = await this.proxyGet<{ stats: Stats }>(`/census/stats?minCell=${minCell}`)
      return stats
    }
    const agg = this.requireBee().sub("agg", { valueEncoding: "utf-8" })
    const dims: Stats = {}
    for await (const { key, value } of agg.createReadStream()) {
      const [dim, ...rest] = key.split("/")
      const label = rest.join("/")
      const count = Number(value)
      // totals + loom_type are quantities, not head-counts → never suppressed;
      // head-count dims below the cell threshold are nulled (re-identification risk).
      ;(dims[dim] ??= {})[label] =
        dim === "total" || dim === "loom_type" ? count : count < minCell ? null : count
    }
    return dims
  }

  /**
   * Resolve a secondary-index "driver" for the given filters, or null if none of
   * the indexed facets are present. The seeder emits three index families whose
   * values line up 1:1 with `agg/*` dims (so counts are O(1)):
   *   idx/state/<state>/<paddedId>
   *   idx/gender/<gender>/<paddedId>
   *   idx/sd/<state>|<district>/<paddedId>   (state-scoped district drill-down)
   * The most selective available family wins; any remaining filters become the
   * `residual` predicate applied in memory to the (already narrowed) records.
   */
  private resolveIndexDriver(filters: WeaverFilters): {
    prefix: string
    aggKey: string
    residual: WeaverFilters
  } | null {
    const state = filters.state != null ? String(filters.state) : null
    const district = filters.district != null ? String(filters.district) : null
    const gender = filters.gender != null ? String(filters.gender) : null

    const without = (...keys: string[]): WeaverFilters => {
      const r = { ...filters }
      for (const k of keys) delete r[k]
      return r
    }

    if (state && district) {
      return { prefix: `sd/${state}|${district}/`, aggKey: `district/${state}|${district}`, residual: without("state", "district") }
    }
    if (state) {
      return { prefix: `state/${state}/`, aggKey: `state/${state}`, residual: without("state") }
    }
    if (gender) {
      return { prefix: `gender/${gender}/`, aggKey: `gender/${gender}`, residual: without("gender") }
    }
    return null
  }

  /**
   * Paginated masked-record browse with equality filters.
   *
   * When the seeder has emitted the secondary index (meta `idx-version` present)
   * and a filter hits an indexed facet, this is an ORDERED range-scan over
   * `idx/<facet>/<value>/*` — O(page), not O(corpus) — with the total lifted from
   * the matching `agg` cell in O(1). That is what makes browse viable across the
   * multi-million sweep (a full `rec/*` scan times out). Falls back to the
   * bounded in-memory scan when there's no index or no indexed filter, preserving
   * the original behaviour.
   *
   * `after` is an opaque cursor (the last census_id of the previous page) enabling
   * O(page) forward pagination that doesn't degrade with depth like `offset`.
   */
  async listAndCountWeavers(
    filters: WeaverFilters = {},
    { limit = 20, offset = 0, after }: ListOptions = {}
  ): Promise<{
    weavers: Record<string, any>[]
    count: number
    capped: boolean
    next?: string | null
    indexed?: boolean
    estimated?: boolean
  }> {
    if (this.proxyUrl) {
      const qs = new URLSearchParams()
      for (const [k, v] of Object.entries(filters)) qs.set(k, String(v))
      qs.set("limit", String(limit))
      qs.set("offset", String(offset))
      if (after != null) qs.set("after", String(after))
      return this.proxyGet(`/census/weavers?${qs.toString()}`)
    }

    const bee = this.requireBee()
    const rec = bee.sub("rec", { valueEncoding: "binary" })

    const driver = this.resolveIndexDriver(filters)
    const indexReady =
      driver != null &&
      (await bee.sub("meta", { valueEncoding: "utf-8" }).get("idx-version")) != null

    if (driver && indexReady) {
      return this.listViaIndex(bee, rec, driver, { limit, offset, after })
    }

    // Fallback: bounded in-memory scan over rec/* (original behaviour).
    const entries = Object.entries(filters)
    const match = (r: Record<string, any>) =>
      entries.every(([k, v]) => String(r[k]) === String(v))

    const weavers: Record<string, any>[] = []
    let count = 0
    let scanned = 0
    let capped = false
    for await (const { value } of rec.createReadStream()) {
      if (++scanned > MAX_SCAN) {
        capped = true
        break
      }
      const r = this.decode(value)
      if (!match(r)) continue
      if (count >= offset && weavers.length < limit) weavers.push(r)
      count++
      // Early-exit once the page is full. Without a secondary index we can't
      // produce an exact total without decoding the whole corpus (up to
      // MAX_SCAN brotli inflations) — which is what made the unfiltered browse
      // time out. Stop at the page window instead and flag the count as a lower
      // bound (`estimated`). Mirrors listViaIndex's O(page) break. No `next`
      // cursor is emitted here: the fallback ignores `after` and rec/* keys
      // aren't numerically ordered, so a cursor would not be re-consumable —
      // forward pagination is only offered on the indexed facet path.
      if (weavers.length >= limit) break
    }
    // `count` is exact only when the scan reached the corpus end before filling
    // the page; if we broke early it's a lower bound, so flag it estimated.
    const estimated = weavers.length >= limit
    return {
      weavers,
      count,
      capped,
      indexed: false,
      ...(estimated ? { estimated: true } : {}),
    }
  }

  /** Range-scan the driver's index family, hydrate + page the records. */
  private async listViaIndex(
    bee: Bee,
    rec: Sub,
    driver: { prefix: string; aggKey: string; residual: WeaverFilters },
    { limit, offset, after }: { limit: number; offset: number; after?: string | number }
  ) {
    const idx = bee.sub("idx", { valueEncoding: "binary" })
    const residualEntries = Object.entries(driver.residual)
    const hasResidual = residualEntries.length > 0
    const residualMatch = (r: Record<string, any>) =>
      residualEntries.every(([k, v]) => String(r[k]) === String(v))

    // sub-relative range over `<prefix><paddedId>`. ":" (0x3a) is the first byte
    // above "9" (0x39), so it upper-bounds the all-digit id suffix.
    const range: { gte?: string; gt?: string; lt: string } =
      after != null
        ? { gt: `${driver.prefix}${padId(after)}`, lt: `${driver.prefix}:` }
        : { gte: driver.prefix, lt: `${driver.prefix}:` }

    const weavers: Record<string, any>[] = []
    let count = 0
    let scanned = 0
    let capped = false
    let next: string | null = null

    for await (const { key } of idx.createReadStream(range)) {
      if (++scanned > MAX_SCAN) {
        capped = true
        break
      }
      const id = String(Number(key.slice(driver.prefix.length)))

      if (!hasResidual) {
        // Purely index-paged: fetch only the page window; total comes from agg.
        if (count >= offset && weavers.length < limit) {
          const node = await rec.get(id)
          if (node) {
            weavers.push(this.decode(node.value))
            next = id
          }
        }
        count++
        if (weavers.length >= limit) break
      } else {
        const node = await rec.get(id)
        if (!node) continue
        const r = this.decode(node.value)
        if (!residualMatch(r)) continue
        if (count >= offset && weavers.length < limit) {
          weavers.push(r)
          next = id
        }
        count++
      }
    }

    // Exact O(1) total from the aggregate cell when the index alone answered the
    // query (no residual predicate). With a residual filter the count is the
    // matches actually scanned (flagged estimated / capped).
    let total = count
    let estimated = hasResidual
    if (!hasResidual) {
      const aggNode = await bee
        .sub("agg", { valueEncoding: "utf-8" })
        .get(driver.aggKey)
      if (aggNode) {
        total = Number(aggNode.value)
        estimated = false
      }
    }

    return {
      weavers,
      count: total,
      capped,
      next,
      indexed: true,
      ...(estimated ? { estimated: true } : {}),
    }
  }
}

// module singleton — the loader wires the live core into this, routes read from it.
export const censusReader = new CensusReader()
