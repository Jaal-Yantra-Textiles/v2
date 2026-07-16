import { brotliCompressSync } from "node:zlib"

import { censusReader } from "../../src/modules/census/reader"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(60 * 1000)

const enc = (r: Record<string, any>) =>
  brotliCompressSync(Buffer.from(JSON.stringify(r)))
const padId = (id: string | number) => String(id).padStart(10, "0")

// A generic in-memory Hyperbee stand-in: a map of named subs, each a sorted
// [key, value] list supporting get + ranged createReadStream (gte/gt/lt). Lets
// the reader exercise BOTH its index range-scan path and its scan fallback
// without the native hypercore stack.
function makeBee(subs: Record<string, Array<[string, any]>>) {
  const sorted: Record<string, Array<[string, any]>> = {}
  for (const [name, entries] of Object.entries(subs)) {
    sorted[name] = [...entries].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  }
  return {
    sub(name: string) {
      const entries = sorted[name] || []
      return {
        async get(key: string) {
          const hit = entries.find(([k]) => k === key)
          return hit ? { value: hit[1] } : null
        },
        async *createReadStream(range?: {
          gte?: string
          gt?: string
          lt?: string
          lte?: string
        }) {
          for (const [key, value] of entries) {
            if (range?.gte !== undefined && key < range.gte) continue
            if (range?.gt !== undefined && key <= range.gt) continue
            if (range?.lt !== undefined && key >= range.lt) continue
            if (range?.lte !== undefined && key > range.lte) continue
            yield { key, value }
          }
        },
      }
    },
  }
}

/** Build rec + agg + (optionally) idx/meta subs from a record set. */
function buildSubs(
  records: Array<Record<string, any>>,
  { indexed }: { indexed: boolean }
) {
  const rec: Array<[string, any]> = records.map((r) => [String(r.census_id), enc(r)])

  // agg counts (utf-8 values) for state / gender / district(state|district).
  const agg = new Map<string, number>()
  const bump = (k: string) => agg.set(k, (agg.get(k) || 0) + 1)
  for (const r of records) {
    bump(`state/${r.state}`)
    bump(`gender/${r.gender}`)
    bump(`district/${r.state}|${r.district}`)
  }
  const aggEntries: Array<[string, any]> = [...agg].map(([k, v]) => [k, String(v)])

  const subs: Record<string, Array<[string, any]>> = { rec: rec, agg: aggEntries }

  if (indexed) {
    const idx: Array<[string, any]> = []
    for (const r of records) {
      const p = padId(r.census_id)
      idx.push([`state/${r.state}/${p}`, Buffer.from("")])
      idx.push([`gender/${r.gender}/${p}`, Buffer.from("")])
      idx.push([`sd/${r.state}|${r.district}/${p}`, Buffer.from("")])
    }
    subs.idx = idx
    subs.meta = [["idx-version", "idx-v1"]]
  }

  return subs
}

const RECORDS = [
  { census_id: 10, state: "KARNATAKA", district: "BAGALKOT", gender: "Male", education: "Middle" },
  { census_id: 11, state: "KARNATAKA", district: "BAGALKOT", gender: "Female", education: "Primary" },
  { census_id: 12, state: "KARNATAKA", district: "BELGAUM", gender: "Male", education: "Middle" },
  { census_id: 13, state: "PUNJAB", district: "AMRITSAR", gender: "Female", education: "Middle" },
  { census_id: 14, state: "KARNATAKA", district: "BAGALKOT", gender: "Male", education: "Primary" },
]

setupSharedTestSuite(() => {
  const api = getSharedTestEnv().api

  // The shared env may set CENSUS_READER_URL → proxy mode, which overrides an
  // embedded bee. Clear it so the in-process fake core is exercised.
  const useBee = (bee: any) => {
    ;(censusReader as any).proxyUrl = null
    censusReader.setBee(bee)
  }

  describe("GET /web/census/weavers — keyed lookup + scan fallback", () => {
    beforeAll(() => useBee(makeBee(buildSubs(RECORDS, { indexed: false }))))

    it("resolves a single record by census_id via the keyed get", async () => {
      const res = await api.get("/web/census/weavers?census_id=12", {
        validateStatus: () => true,
      })
      expect(res.status).toBe(200)
      expect(res.data.weaver).toMatchObject({ census_id: 12, district: "BELGAUM" })
      expect(res.data.weavers).toBeUndefined()
    })

    it("returns 404 for an unknown census_id", async () => {
      const res = await api.get("/web/census/weavers?census_id=999", {
        validateStatus: () => true,
      })
      expect(res.status).toBe(404)
    })

    it("filters via the bounded scan when no index is present", async () => {
      const res = await api.get("/web/census/weavers?state=KARNATAKA", {
        validateStatus: () => true,
      })
      expect(res.status).toBe(200)
      expect(res.data.indexed).toBe(false)
      expect(res.data.count).toBe(4)
      expect(res.data.weavers).toHaveLength(4)
      expect(res.data.weavers.every((w: any) => w.state === "KARNATAKA")).toBe(true)
    })
  })

  describe("GET /web/census/weavers — secondary-index fast path", () => {
    beforeAll(() => useBee(makeBee(buildSubs(RECORDS, { indexed: true }))))

    it("browses a state facet via the index with an O(1) agg count", async () => {
      const res = await api.get("/web/census/weavers?state=KARNATAKA", {
        validateStatus: () => true,
      })
      expect(res.status).toBe(200)
      expect(res.data.indexed).toBe(true)
      // exact total from the agg cell (all 4 KARNATAKA), not just the page
      expect(res.data.count).toBe(4)
      expect(res.data.weavers.every((w: any) => w.state === "KARNATAKA")).toBe(true)
      // ordered by census_id ascending
      const ids = res.data.weavers.map((w: any) => w.census_id)
      expect(ids).toEqual([...ids].sort((a, b) => a - b))
    })

    it("drills into a state|district facet", async () => {
      const res = await api.get(
        "/web/census/weavers?state=KARNATAKA&district=BAGALKOT",
        { validateStatus: () => true }
      )
      expect(res.status).toBe(200)
      expect(res.data.indexed).toBe(true)
      expect(res.data.count).toBe(3)
      expect(
        res.data.weavers.every((w: any) => w.district === "BAGALKOT")
      ).toBe(true)
    })

    it("cursor-paginates with `after` (no overlap, ordered)", async () => {
      const p1 = await api.get("/web/census/weavers?state=KARNATAKA&limit=2", {
        validateStatus: () => true,
      })
      expect(p1.data.weavers).toHaveLength(2)
      expect(p1.data.next).toBeDefined()

      const p2 = await api.get(
        `/web/census/weavers?state=KARNATAKA&limit=2&after=${p1.data.next}`,
        { validateStatus: () => true }
      )
      const ids1 = p1.data.weavers.map((w: any) => w.census_id)
      const ids2 = p2.data.weavers.map((w: any) => w.census_id)
      // disjoint pages, all still ascending
      expect(ids1.some((id: number) => ids2.includes(id))).toBe(false)
      expect(Math.max(...ids1)).toBeLessThan(Math.min(...ids2))
    })

    it("applies a residual (non-indexed) filter on the narrowed set", async () => {
      const res = await api.get(
        "/web/census/weavers?state=KARNATAKA&education=Middle",
        { validateStatus: () => true }
      )
      expect(res.status).toBe(200)
      expect(res.data.indexed).toBe(true)
      // KARNATAKA + Middle → census_id 10 and 12
      expect(res.data.count).toBe(2)
      expect(res.data.estimated).toBe(true)
      expect(res.data.weavers.map((w: any) => w.census_id).sort()).toEqual([10, 12])
    })

    it("still resolves a single record by census_id", async () => {
      const res = await api.get("/web/census/weavers?census_id=13", {
        validateStatus: () => true,
      })
      expect(res.status).toBe(200)
      expect(res.data.weaver).toMatchObject({ census_id: 13, state: "PUNJAB" })
    })
  })
})
