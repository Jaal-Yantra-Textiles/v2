import { brotliCompressSync } from "node:zlib"

import { censusReader, normalizeName } from "../reader"

// Minimal in-memory stand-in for the narrow Bee/Sub surface reader.ts consumes
// (sub → { get, createReadStream }). Keys are plain strings; the reader passes
// RELATIVE keys (e.g. "name/mustaq/…", "idx-name-version") which we store per-sub.
class FakeBee {
  subs = new Map<string, Map<string, Buffer>>()

  constructor() {
    for (const n of ["rec", "meta", "agg", "idx"]) this.subs.set(n, new Map())
  }

  sub(name: string): any {
    const m = this.subs.get(name)!
    return {
      get: async (key: string) => {
        const v = m.get(key)
        return v != null ? { value: v } : null
      },
      createReadStream: (range?: { gte?: string; gt?: string; lte?: string; lt?: string }) => {
        const keys = [...m.keys()].sort()
        const out = keys.filter((k) => {
          if (range?.gte != null && k < range.gte) return false
          if (range?.gt != null && k <= range.gt) return false
          if (range?.lt != null && k >= range.lt) return false
          if (range?.lte != null && k > range.lte) return false
          return true
        })
        const self = m
        return (async function* () {
          for (const k of out) yield { key: k, value: self.get(k)! }
        })()
      },
    }
  }
}

const padId = (id: number) => String(id).padStart(10, "0")
const compress = (o: object) => brotliCompressSync(Buffer.from(JSON.stringify(o)))

describe("CensusReader.listAndCountWeavers — indexed facets", () => {
  const records = [
    { census_id: 9000001, name: "MUSTAQ AHMED", state: "BIHAR", district: "GAYA", gender: "Male", education: "Middle", own_looms: true },
    { census_id: 9000002, name: "Mustaq Ali", state: "UTTAR PRADESH", district: "LUCKNOW", gender: "Male", education: "Middle", own_looms: false },
    { census_id: 9000003, name: "Abdul Mustaq", state: "BIHAR", district: "GAYA", gender: "Male", education: "High", own_looms: true },
    { census_id: 9000004, name: "Ramesh Kumar", state: "BIHAR", district: "GAYA", gender: "Male", education: "High", own_looms: false },
  ]

  // Build an index that mirrors what the seeder emits: `all/*` + `name/<normalized>/*`
  // + equality facets (`education/*`, `own_looms/*`), each value carrying the inline payload.
  const buildBee = () => {
    const bee = new FakeBee()
    const meta = bee.subs.get("meta")!
    meta.set("idx-version", Buffer.from("idx-v1"))
    meta.set("idx-all-version", Buffer.from("idxall-v1"))
    meta.set("idx-name-version", Buffer.from("idxname-v1"))
    meta.set("idx-eq-version", Buffer.from("idxeq-v1"))
    meta.set("idx-geo-version", Buffer.from("geo-v1"))

    const idx = bee.subs.get("idx")!
    for (const r of records) {
      const payload = compress(r)
      const p = padId(r.census_id)
      idx.set(`all/${p}`, payload)
      idx.set(`name/${normalizeName(r.name)}/${p}`, payload)
      idx.set(`education/${r.education}/${p}`, payload)
      idx.set(`own_looms/${String(r.own_looms)}/${p}`, payload)
    }
    return bee
  }

  const prevBee = (censusReader as any).bee
  const prevProxy = (censusReader as any).proxyUrl

  afterAll(() => {
    ;(censusReader as any).bee = prevBee
    ;(censusReader as any).proxyUrl = prevProxy
  })

  it("normalizeName lowercases and collapses separators", () => {
    expect(normalizeName("MUSTAQ AHMED")).toBe("mustaq_ahmed")
    expect(normalizeName("  Mohd. Shahid  ")).toBe("mohd_shahid")
    expect(normalizeName("")).toBe("")
  })

  it("name search range-scans the name index (prefix) instead of the whole corpus", async () => {
    ;(censusReader as any).proxyUrl = null
    ;(censusReader as any).bee = buildBee()

    const res = await censusReader.listAndCountWeavers(
      { name: "mustaq" },
      { limit: 10, offset: 0 }
    )

    const ids = res.weavers.map((w: any) => w.census_id).sort((a: number, b: number) => a - b)
    expect(ids).toEqual([9000001, 9000002])
    expect(res.count).toBe(2)
    // name has no agg cell → flagged estimated
    expect((res as any).estimated).toBe(true)
  })

  it("falls back to the bounded scan when the name index is not backfilled", async () => {
    const bee = buildBee()
    bee.subs.get("meta")!.delete("idx-name-version")
    ;(censusReader as any).proxyUrl = null
    ;(censusReader as any).bee = bee

    const res = await censusReader.listAndCountWeavers(
      { name: "mustaq" },
      { limit: 10, offset: 0 }
    )

    // Without the name index, the fallback scans rec/* — but this fake has no
    // rec/* rows, so nothing matches. The point is that it does NOT throw and
    // flags indexed:false.
    expect((res as any).indexed).toBe(false)
  })

  it("equality facet (education) range-scans its family instead of the corpus", async () => {
    ;(censusReader as any).proxyUrl = null
    ;(censusReader as any).bee = buildBee()

    const res = await censusReader.listAndCountWeavers(
      { education: "Middle" },
      { limit: 10, offset: 0 }
    )

    const ids = res.weavers.map((w: any) => w.census_id).sort((a: number, b: number) => a - b)
    expect(ids).toEqual([9000001, 9000002])
    expect(res.count).toBe(2)
    expect((res as any).estimated).toBe(true)
  })

  it("boolean facet (own_looms) matches stringified true/false", async () => {
    ;(censusReader as any).proxyUrl = null
    ;(censusReader as any).bee = buildBee()

    const owners = await censusReader.listAndCountWeavers(
      { own_looms: "true" },
      { limit: 10, offset: 0 }
    )
    expect(owners.weavers.map((w: any) => w.census_id).sort((a: number, b: number) => a - b)).toEqual([9000001, 9000003])

    const nonOwners = await censusReader.listAndCountWeavers(
      { own_looms: "false" },
      { limit: 10, offset: 0 }
    )
    expect(nonOwners.weavers.map((w: any) => w.census_id).sort((a: number, b: number) => a - b)).toEqual([9000002, 9000004])
  })

  it("falls back to the bounded scan when the eq index is not backfilled", async () => {
    const bee = buildBee()
    bee.subs.get("meta")!.delete("idx-eq-version")
    ;(censusReader as any).proxyUrl = null
    ;(censusReader as any).bee = bee

    const res = await censusReader.listAndCountWeavers(
      { education: "Middle" },
      { limit: 10, offset: 0 }
    )
    expect((res as any).indexed).toBe(false)
  })
})