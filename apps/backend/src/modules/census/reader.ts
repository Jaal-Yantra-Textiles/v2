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
  createReadStream(range?: { gte?: string; lte?: string; lt?: string }): AsyncIterable<{ key: string; value: any }>
}
type Bee = { sub(prefix: string, opts?: Record<string, unknown>): Sub }

export type WeaverFilters = Record<string, string | number | boolean>
export type ListOptions = { limit?: number; offset?: number }
export type Stats = Record<string, Record<string, number | null>>

/**
 * Read-only query surface over the handloom census PUBLIC core (masked, PII-free
 * records + pre-computed aggregates written by the P2P seeder). Held as a module
 * singleton; the loader replicates the core over Hyperswarm and calls setBee once
 * the Hyperbee is open. Until then `ready` is false and methods throw a clear error.
 */
export class CensusReader {
  private bee: Bee | null = null

  setBee(bee: Bee) {
    this.bee = bee
  }

  get ready(): boolean {
    return this.bee !== null
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
   * Paginated masked-record browse with equality filters. The live public core
   * carries no secondary index yet, so this scans `rec/*` and filters in memory,
   * bounded by MAX_SCAN. Fine for modest result sets / early data; for the full
   * multi-million sweep the seeder should emit `idx/<field>/<value>/<id>` cells
   * (proven in hyperbee-repo.mjs) so this becomes an index intersection.
   */
  async listAndCountWeavers(
    filters: WeaverFilters = {},
    { limit = 20, offset = 0 }: ListOptions = {}
  ): Promise<{ weavers: Record<string, any>[]; count: number; capped: boolean }> {
    const rec = this.requireBee().sub("rec", { valueEncoding: "binary" })
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
      // count all matches; collect only the requested page window
      if (count >= offset && weavers.length < limit) weavers.push(r)
      count++
    }
    return { weavers, count, capped }
  }
}

// module singleton — the loader wires the live core into this, routes read from it.
export const censusReader = new CensusReader()
