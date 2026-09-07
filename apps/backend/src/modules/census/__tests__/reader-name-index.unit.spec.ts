import { readFileSync } from "node:fs"
import { join } from "node:path"
import { brotliCompressSync } from "node:zlib"

import { censusReader, normalizeName } from "../reader"

// The seeder half of this contract is a plain .mjs script outside the backend's
// tsconfig, so it can't be imported here — but its lists MUST match the reader's
// or the index and the reader address different keys and silently never match.
// Read the source and compare the literals.
const INDEX_MJS = readFileSync(
  join(__dirname, "../../../../../../scripts/handloom-scrape/hyperbee-slice/census_index.mjs"),
  "utf8"
)
const listFromMjs = (name: string): string[] => {
  const m = INDEX_MJS.match(new RegExp(`export const ${name} = \\[([^\\]]*)\\]`))
  if (!m) throw new Error(`${name} not found in census_index.mjs`)
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1])
}

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
    { census_id: 9000005, name: "Ravi Ravindra Ravi", state: "BIHAR", district: "GAYA", gender: "Male", education: "High", own_looms: true },
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
    const agg = bee.subs.get("agg")!
    const counts = new Map<string, number>()
    for (const r of records) {
      const payload = compress(r)
      const p = padId(r.census_id)
      idx.set(`all/${p}`, payload)
      // exactly what idxRelKeys emits: the full normalized name AND each token.
      const n = normalizeName(r.name)
      for (const t of new Set([n, ...n.split("_")])) idx.set(`name/${t}/${p}`, payload)
      idx.set(`education/${r.education}/${p}`, payload)
      idx.set(`own_looms/${String(r.own_looms)}/${p}`, payload)
      for (const k of [`eq/education/${r.education}`, `eq/own_looms/${String(r.own_looms)}`]) {
        counts.set(k, (counts.get(k) ?? 0) + 1)
      }
    }
    for (const [k, v] of counts) agg.set(k, Buffer.from(String(v)))
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
    // 9000003 is "Abdul Mustaq" — found through its TOKEN, which the old
    // full-name-prefix-only index answered with a silent zero.
    expect(ids).toEqual([9000001, 9000002, 9000003])
    expect(res.count).toBe(3)
    // a name prefix has no agg cell → flagged estimated
    expect((res as any).estimated).toBe(true)
  })

  it("returns a weaver ONCE even when several of its name keys match", async () => {
    ;(censusReader as any).proxyUrl = null
    ;(censusReader as any).bee = buildBee()

    // "Ravi Ravindra Ravi" is indexed under ravi_ravindra_ravi, ravi and ravindra
    // — a `ravi` prefix hits all three. Without dedupe the same weaver pages out
    // repeatedly.
    const res = await censusReader.listAndCountWeavers({ name: "ravi" }, { limit: 10, offset: 0 })
    expect(res.weavers.map((w: any) => w.census_id)).toEqual([9000005])
    expect(res.count).toBe(1)
  })

  it("emits no cursor for a name scan (it is ordered by token, not id)", async () => {
    ;(censusReader as any).proxyUrl = null
    ;(censusReader as any).bee = buildBee()

    const res = await censusReader.listAndCountWeavers({ name: "mustaq" }, { limit: 1, offset: 0 })
    // an id-shaped `after` cannot resume a (token, id) ordering — handing one back
    // would make the next page repeat page one forever.
    expect(res.next).toBeNull()
  })

  it("keeps the reader's facet list identical to the seeder's", () => {
    // drift here is silent: the index writes one key, the reader reads another.
    expect(listFromMjs("EQ_FIELDS")).toEqual([
      "village", "block", "district", "education", "ownership_type",
      "household_type", "dwelling_type", "rural_urban",
      "own_looms", "natural_dye_used", "electricity",
    ])
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
    // the count comes from `agg/eq/education/Middle` in O(1) — NOT from draining
    // the family, which is what kept this request at the corpus-scan ceiling.
    expect(res.count).toBe(2)
    expect((res as any).estimated).toBeUndefined()
  })


  it("boolean facet (own_looms) matches stringified true/false", async () => {
    ;(censusReader as any).proxyUrl = null
    ;(censusReader as any).bee = buildBee()

    const owners = await censusReader.listAndCountWeavers(
      { own_looms: "true" },
      { limit: 10, offset: 0 }
    )
    expect(owners.weavers.map((w: any) => w.census_id).sort((a: number, b: number) => a - b)).toEqual([9000001, 9000003, 9000005])

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
