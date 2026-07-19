import { brotliDecompress } from "node:zlib"
import { promisify } from "node:util"

// Decompress OFF the event loop (libuv threadpool). The sync variant froze the
// single-threaded server for the whole duration of a large scan — every other
// request and the ALB/ECS health check stalled with it, so the task got killed
// and restarted, which read as a "crash". Never reintroduce brotliDecompressSync
// on a hot path.
const brotliDecompressAsync = promisify(brotliDecompress)

// k-anonymity: aggregate cells below this are suppressed (null) for public output.
const MIN_CELL = 5
// safety cap on a residual full-record scan (the fallback path, taken only when
// the relevant index family hasn't been backfilled yet). Bounds worst-case work;
// we flag when a scan is capped rather than silently truncating.
const MAX_SCAN = 50_000
// Yield to the event loop every N scanned records in the fallback so a large
// residual scan can't starve health checks / concurrent requests even though
// each decode is already off-thread.
const YIELD_EVERY = 256

// Hydration concurrency: each rec.get is an INDEPENDENT seek, so draining the
// index with a bounded worker pool turns N sequential seeks into ~N/POOL. Over a
// remote P2P peer each seek is an RTT; even against a local replica it overlaps
// disk + brotli. Bounded so we never open thousands of concurrent seeks at once.
const HYDRATE_CONCURRENCY = Number(process.env.CENSUS_HYDRATE_CONCURRENCY || 12)
const HYDRATE_BATCH = HYDRATE_CONCURRENCY * 4

// Decoded-record LRU: the seek+brotli is the cost, so cache the decoded records.
// Helps repeated reads, the /verify path, and residual re-scans. A short TTL
// bounds staleness if the underlying core replicates a newer version.
const REC_CACHE_MAX = Number(process.env.CENSUS_REC_CACHE_MAX || 5000)
const REC_CACHE_TTL_MS = Number(process.env.CENSUS_REC_CACHE_TTL_MS || 300_000)
// Stats memo: the agg stream is cheap but there's no reason to re-walk it on
// every request — aggregates only change on re-seed.
const STATS_MEMO_TTL_MS = Number(process.env.CENSUS_STATS_MEMO_TTL_MS || 60_000)

/** Tiny insertion-ordered LRU with per-entry TTL — no external dependency. */
class TtlLru<V> {
  private map = new Map<string, { v: V; exp: number }>()
  constructor(private max: number, private ttlMs: number) {}
  get(k: string): V | undefined {
    const e = this.map.get(k)
    if (!e) return undefined
    if (e.exp <= Date.now()) {
      this.map.delete(k)
      return undefined
    }
    // bump recency: re-insert so it moves to the tail
    this.map.delete(k)
    this.map.set(k, e)
    return e.v
  }
  set(k: string, v: V): void {
    if (this.map.has(k)) this.map.delete(k)
    this.map.set(k, { v, exp: Date.now() + this.ttlMs })
    if (this.map.size > this.max) {
      const oldest = this.map.keys().next().value
      if (oldest !== undefined) this.map.delete(oldest)
    }
  }
}

// meta flags the seeder sets once an index family has been backfilled. The facet
// families (state/gender/sd) gate on FACET_IDX_META; the whole-corpus ordered
// `all` family gates on ALL_IDX_META — decoupled so the unfiltered browse only
// takes the index path once ITS backfill has run (otherwise it would range-scan
// an empty `idx/all/*` family and return nothing).
const FACET_IDX_META = "idx-version"
const ALL_IDX_META = "idx-all-version"
// Set once the backfill has written the inline DISPLAY PAYLOAD into every index
// family value (see census_index.mjs geoPayload). When present, browse decodes
// that small payload straight off the ordered index scan instead of doing a
// random rec/* seek + 125-field brotli inflate per row — the whole point of the
// speedup. Absent → we fall back to hydrating the fat rec/* record. MUST match
// census_index.mjs IDX_GEO_VERSION's meta key.
const GEO_IDX_META = "idx-geo-version"

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
  private recCache = new TtlLru<Record<string, any>>(REC_CACHE_MAX, REC_CACHE_TTL_MS)
  private statsMemo: { at: number; minCell: number; value: Stats } | null = null

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

  private async decode(buf: Buffer): Promise<Record<string, any>> {
    return JSON.parse((await brotliDecompressAsync(buf)).toString())
  }

  /** rec.get + decode, memoized in the LRU (keyed by census_id). */
  private async getDecoded(rec: Sub, id: string): Promise<Record<string, any> | null> {
    const cached = this.recCache.get(id)
    if (cached) return cached
    const node = await rec.get(id)
    if (!node) return null
    const r = await this.decode(node.value)
    this.recCache.set(id, r)
    return r
  }

  /**
   * Geo-index path: decode the inline display payload carried on an index row's
   * value. Falls back to the fat rec/* record only when the value is empty — a
   * row written before the geo backfill, or by the seeder's forward path pre-
   * upgrade. Payloads are cached under a "g:" prefix so they never collide with
   * full records cached by getDecoded (retrieveWeaver still returns the full bag).
   */
  private async decodeIndexRow(
    rec: Sub,
    id: string,
    value: any
  ): Promise<Record<string, any> | null> {
    const buf: Buffer | undefined =
      value != null && typeof value.length === "number" ? value : undefined
    if (buf && buf.length > 0) {
      const cached = this.recCache.get("g:" + id)
      if (cached) return cached
      try {
        const r = await this.decode(buf)
        this.recCache.set("g:" + id, r)
        return r
      } catch {
        // torn/corrupt payload — fall through to the authoritative rec/* record
      }
    }
    return this.getDecoded(rec, id)
  }

  /** Bounded-concurrency, order-preserving hydration of a list of census ids. */
  private async hydrateInOrder(
    rec: Sub,
    ids: string[]
  ): Promise<(Record<string, any> | null)[]> {
    const out: (Record<string, any> | null)[] = new Array(ids.length)
    let cursor = 0
    const worker = async () => {
      while (true) {
        const i = cursor++
        if (i >= ids.length) return
        out[i] = await this.getDecoded(rec, ids[i])
      }
    }
    const n = Math.min(HYDRATE_CONCURRENCY, ids.length)
    await Promise.all(Array.from({ length: n }, () => worker()))
    return out
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
    return await this.getDecoded(rec, String(id))
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
    const memo = this.statsMemo
    if (memo && memo.minCell === minCell && Date.now() - memo.at < STATS_MEMO_TTL_MS) {
      return memo.value
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
    this.statsMemo = { at: Date.now(), minCell, value: dims }
    return dims
  }

  /**
   * Resolve a secondary-index "driver" for the given filters, or null if none of
   * the indexed facets are present. The seeder emits three index families whose
   * values line up 1:1 with `agg/*` dims (so counts are O(1)):
   *   idx/state/<state>/<paddedId>
   *   idx/gender/<gender>/<paddedId>
   *   idx/sd/<state>|<district>/<paddedId>   (state-scoped district drill-down)
   *   idx/all/<paddedId>                     (whole corpus, ordered by id)
   * The most selective available family wins; any remaining filters become the
   * `residual` predicate applied in memory to the (already narrowed) records.
   * When no facet filter is present we fall to the `all` family so the common
   * unfiltered map browse is an O(page) range-scan with an O(1) exact total —
   * NOT the O(corpus) rec/* scan that used to time the storefront out.
   */
  private resolveIndexDriver(filters: WeaverFilters): {
    prefix: string
    aggKey: string
    residual: WeaverFilters
    metaKey: string
  } {
    const state = filters.state != null ? String(filters.state) : null
    const district = filters.district != null ? String(filters.district) : null
    const gender = filters.gender != null ? String(filters.gender) : null

    const without = (...keys: string[]): WeaverFilters => {
      const r = { ...filters }
      for (const k of keys) delete r[k]
      return r
    }

    if (state && district) {
      return { prefix: `sd/${state}|${district}/`, aggKey: `district/${state}|${district}`, residual: without("state", "district"), metaKey: FACET_IDX_META }
    }
    if (state) {
      return { prefix: `state/${state}/`, aggKey: `state/${state}`, residual: without("state"), metaKey: FACET_IDX_META }
    }
    if (gender) {
      return { prefix: `gender/${gender}/`, aggKey: `gender/${gender}`, residual: without("gender"), metaKey: FACET_IDX_META }
    }
    // No indexed facet → browse the whole corpus in id order. Exact total comes
    // from the O(1) `total/weavers` aggregate; any non-facet filters (district
    // alone, village, education, …) ride along as a residual predicate.
    return { prefix: "all/", aggKey: "total/weavers", residual: { ...filters }, metaKey: ALL_IDX_META }
  }

  /**
   * Paginated masked-record browse with equality filters.
   *
   * When the seeder has emitted the secondary index (meta `idx-version` present)
   * and a filter hits an indexed facet, this is an ORDERED range-scan over
   * `idx/<facet>/<value>/*` — O(page), not O(corpus) — with the total lifted from
   * the matching `agg` cell in O(1). That is what makes browse viable across the
   * multi-million sweep (a full `rec/*` scan times out). The unfiltered browse
   * rides the `all` family the same way (exact total from `total/weavers`). Only
   * falls back to the bounded in-memory scan when the driver's index family
   * hasn't been backfilled yet — and that scan now decodes off-thread + yields,
   * so it can't freeze the server even at the MAX_SCAN ceiling.
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
    // The driver's family must be backfilled (its meta flag set) before we range
    // -scan it; until then we take the bounded fallback below. resolveIndexDriver
    // always returns a driver now (the `all` family covers the no-facet case), so
    // this gate is the only thing that keeps us off an un-backfilled family.
    const metaSub = bee.sub("meta", { valueEncoding: "utf-8" })
    const indexReady = (await metaSub.get(driver.metaKey)) != null

    if (indexReady) {
      // Whether the inline display payload has been backfilled onto index values.
      const geoReady = (await metaSub.get(GEO_IDX_META)) != null
      return this.listViaIndex(bee, rec, driver, { limit, offset, after }, geoReady)
    }

    // Fallback: bounded in-memory scan over rec/* (only when the driver's index
    // family hasn't been backfilled yet). Decodes off-thread + yields to the
    // event loop so it can't freeze the server even at the MAX_SCAN ceiling.
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
      if (scanned % YIELD_EVERY === 0) await new Promise((r) => setImmediate(r))
      const r = await this.decode(value)
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
    { limit, offset, after }: { limit: number; offset: number; after?: string | number },
    geoReady = false
  ) {
    const idx = bee.sub("idx", { valueEncoding: "binary" })
    const residualEntries = Object.entries(driver.residual)
    const hasResidual = residualEntries.length > 0
    const residualMatch = (r: Record<string, any>) =>
      residualEntries.every(([k, v]) => String(r[k]) === String(v))

    // Hydrate a page of index rows. With the geo payload backfilled, decode the
    // inline value carried on each row — no random rec/* seek, no fat-record
    // inflate (falls back to rec/* only for a row whose value is still empty).
    // Otherwise (pre-backfill) hydrate the authoritative rec/* record by id.
    const hydratePage = (
      rows: { id: string; value: any }[]
    ): Promise<(Record<string, any> | null)[]> =>
      geoReady
        ? Promise.all(rows.map((r) => this.decodeIndexRow(rec, r.id, r.value)))
        : this.hydrateInOrder(rec, rows.map((r) => r.id))

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

    if (!hasResidual) {
      // Purely index-paged: walk the ordered index to the page window, collect its
      // rows, then hydrate that page in PARALLEL (inline payload when geoReady, else
      // rec/*). Total comes from agg (O(1)) below, so counting past the page is
      // unnecessary. `value` rides along so the geo path needs no second read.
      const pageRows: { id: string; value: any }[] = []
      for await (const { key, value } of idx.createReadStream(range)) {
        if (++scanned > MAX_SCAN) {
          capped = true
          break
        }
        if (count >= offset && pageRows.length < limit) {
          pageRows.push({ id: String(Number(key.slice(driver.prefix.length))), value })
        }
        count++
        if (pageRows.length >= limit) break
      }
      const hydrated = await hydratePage(pageRows)
      for (let j = 0; j < hydrated.length; j++) {
        const r = hydrated[j]
        if (r) {
          weavers.push(r)
          next = pageRows[j].id
        }
      }
    } else {
      // Residual predicate needs the decoded record, so every id in the family
      // must be hydrated (up to MAX_SCAN) to count exact matches. Do it in ordered,
      // bounded-concurrency batches instead of one blocking seek at a time.
      let batch: { id: string; value: any }[] = []
      const drain = async () => {
        const hydrated = await hydratePage(batch)
        for (let j = 0; j < hydrated.length; j++) {
          const r = hydrated[j]
          if (!r || !residualMatch(r)) continue
          if (count >= offset && weavers.length < limit) {
            weavers.push(r)
            next = batch[j].id
          }
          count++
        }
        batch = []
      }
      for await (const { key, value } of idx.createReadStream(range)) {
        if (++scanned > MAX_SCAN) {
          capped = true
          break
        }
        batch.push({ id: String(Number(key.slice(driver.prefix.length))), value })
        if (batch.length >= HYDRATE_BATCH) await drain()
      }
      if (batch.length) await drain()
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
