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

// The lean display projection the seeder stores inline on each index value
// (mirrors census_index.geoPayload): the map's fields + coords promoted from the
// raw survey bag. Deliberately EXCLUDES the `fat` sentinel below, so a browse
// that returns it proves the reader decoded the payload, not the rec/* record.
const geoProj = (r: Record<string, any>) => {
  const sv = r.survey || {}
  return {
    census_id: r.census_id,
    state: r.state,
    district: r.district,
    gender: r.gender,
    education: r.education,
    village: r.village,
    latitude: Number(sv.Latitude),
    longitude: Number(sv.Longitude),
  }
}

/** Build rec + agg + (optionally) idx/meta subs from a record set. */
function buildSubs(
  records: Array<Record<string, any>>,
  { indexed, geo = false }: { indexed: boolean; geo?: boolean }
) {
  const rec: Array<[string, any]> = records.map((r) => [String(r.census_id), enc(r)])

  // agg counts (utf-8 values) for state / gender / district(state|district).
  const agg = new Map<string, number>()
  const bump = (k: string) => agg.set(k, (agg.get(k) || 0) + 1)
  for (const r of records) {
    bump(`total/weavers`) // whole-corpus total → O(1) count for the `all` driver
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
      // geo mode carries the inline payload on the value; legacy mode is keys-only.
      const val = geo ? enc(geoProj(r)) : Buffer.from("")
      idx.push([`all/${p}`, val])
      idx.push([`state/${r.state}/${p}`, val])
      idx.push([`gender/${r.gender}/${p}`, val])
      idx.push([`sd/${r.state}|${r.district}/${p}`, val])
    }
    subs.idx = idx
    subs.meta = geo
      ? [["idx-version", "idx-v1"], ["idx-all-version", "idxall-v1"], ["idx-geo-version", "geo-v1"]]
      : [["idx-version", "idx-v1"], ["idx-all-version", "idxall-v1"]]
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

    it("unfiltered browse early-exits at the page window (estimated, no freeze)", async () => {
      // No `all` family backfilled → fallback. It must NOT scan the whole corpus
      // to compute a total: it stops at the page and flags the count estimated.
      const res = await api.get("/web/census/weavers?limit=2", {
        validateStatus: () => true,
      })
      expect(res.status).toBe(200)
      expect(res.data.indexed).toBe(false)
      expect(res.data.weavers).toHaveLength(2)
      expect(res.data.estimated).toBe(true)
      expect(res.data.next).toBeUndefined() // no cursor on the fallback path
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

    it("browses the whole corpus via the `all` family with an exact O(1) total", async () => {
      const res = await api.get("/web/census/weavers?limit=2", {
        validateStatus: () => true,
      })
      expect(res.status).toBe(200)
      expect(res.data.indexed).toBe(true)
      // exact total from the `total/weavers` agg cell (all 5), not the page size
      expect(res.data.count).toBe(5)
      expect(res.data.estimated).toBeUndefined()
      expect(res.data.weavers).toHaveLength(2)
      // ordered by census_id ascending, with a re-consumable cursor
      const ids = res.data.weavers.map((w: any) => w.census_id)
      expect(ids).toEqual([10, 11])
      expect(res.data.next).toBeDefined()

      const p2 = await api.get(`/web/census/weavers?limit=2&after=${res.data.next}`, {
        validateStatus: () => true,
      })
      expect(p2.data.weavers.map((w: any) => w.census_id)).toEqual([12, 13])
    })

    it("applies a non-facet residual filter over the `all` family", async () => {
      const res = await api.get("/web/census/weavers?education=Primary", {
        validateStatus: () => true,
      })
      expect(res.status).toBe(200)
      expect(res.data.indexed).toBe(true)
      expect(res.data.estimated).toBe(true) // residual → count is scanned matches
      expect(res.data.weavers.map((w: any) => w.census_id).sort()).toEqual([11, 14])
    })
  })

  describe("GET /web/census/weavers — inline geo-payload fast path", () => {
    // rec/* carries a fat `survey` bag + a `fat` sentinel; the index payload is the
    // lean projection WITHOUT `fat`. So a browse that returns coords but no `fat`
    // proves the reader decoded the inline payload and never touched rec/*.
    // distinct ids (+10) so the reader's per-id LRU can't hand us a record cached
    // by the earlier RECORDS-based suites (which lack the `fat` sentinel).
    const GEO_RECORDS = RECORDS.map((r, i) => ({
      ...r,
      census_id: r.census_id + 10,
      village: `V${r.census_id + 10}`,
      fat: "FROM_REC_SHOULD_NOT_APPEAR",
      survey: { Latitude: `${16 + i / 100}`, Longitude: `${75 + i / 100}`, blob: "x".repeat(80) },
    }))

    beforeAll(() => useBee(makeBee(buildSubs(GEO_RECORDS, { indexed: true, geo: true }))))

    it("browses a state facet from the inline payload (coords present, rec/* untouched)", async () => {
      const res = await api.get("/web/census/weavers?state=KARNATAKA", {
        validateStatus: () => true,
      })
      expect(res.status).toBe(200)
      expect(res.data.indexed).toBe(true)
      expect(res.data.count).toBe(4)
      for (const w of res.data.weavers) {
        expect(typeof w.latitude).toBe("number") // promoted from survey.Latitude
        expect(w.longitude).toBeGreaterThan(74)
        expect(w.fat).toBeUndefined() // payload, not the fat rec/* record
        expect(w.survey).toBeUndefined()
      }
    })

    it("browses the whole corpus from the inline payload with an O(1) total", async () => {
      const res = await api.get("/web/census/weavers?limit=2", {
        validateStatus: () => true,
      })
      expect(res.status).toBe(200)
      expect(res.data.count).toBe(5)
      expect(res.data.weavers.map((w: any) => w.census_id)).toEqual([20, 21])
      expect(res.data.weavers.every((w: any) => w.fat === undefined)).toBe(true)
      expect(res.data.weavers.every((w: any) => typeof w.latitude === "number")).toBe(true)
    })

    it("applies a residual filter on the payload fields", async () => {
      const res = await api.get("/web/census/weavers?state=KARNATAKA&education=Middle", {
        validateStatus: () => true,
      })
      expect(res.status).toBe(200)
      expect(res.data.weavers.map((w: any) => w.census_id).sort()).toEqual([20, 22])
    })

    it("falls back to rec/* for a row whose inline payload is empty", async () => {
      // Simulate a record seeded before the geo backfill (blank idx value): the
      // reader must still return it, hydrated from the authoritative rec/* record.
      const subs = buildSubs(GEO_RECORDS, { indexed: true, geo: true })
      subs.idx = subs.idx!.map(([k, v]) =>
        k === `state/KARNATAKA/${padId(22)}` ? [k, Buffer.from("")] : [k, v]
      )
      useBee(makeBee(subs))
      const res = await api.get("/web/census/weavers?state=KARNATAKA", {
        validateStatus: () => true,
      })
      expect(res.status).toBe(200)
      const w22 = res.data.weavers.find((w: any) => w.census_id === 22)
      expect(w22).toBeDefined()
      expect(w22.fat).toBe("FROM_REC_SHOULD_NOT_APPEAR") // came from rec/* fallback
    })
  })

  describe("GET /web/census/weavers — PII masking", () => {
    // A record shaped like the real corpus: a fat raw `survey` bag (real name,
    // EXACT coords, PIN/income re-dump under numbered keys) plus — to prove the
    // defensive strip — raw contact/identity values that a future re-seed might
    // carry. The masked-public fields (mobile_masked + the *_available presence
    // flags) must survive as the "verified" signal.
    const PII_RECORDS = [
      {
        census_id: 30,
        state: "UTTAR PRADESH",
        district: "SITAPUR",
        village: "MAHMOODPUR",
        gender: "Male",
        mobile_masked: "91XXXXXXXXXX",
        aadhaar_card_available: true,
        voter_id_available: true,
        // raw values that must never ship
        mobile: "9812345678",
        aadhaar_number: "123412341234",
        pan: "ABCDE1234F",
        bank_account: "00112233445566",
        ifsc: "SBIN0001234",
        father_husband_name: "SOMEONE ELSE",
        survey: {
          Name: "MOHD SHAHID",
          Latitude: "27.2823364",
          Longitude: "81.1697055",
          "2.6": "261203", // PIN
          "3.9.1": "Less than 5000", // income band
          "1.9": "91XXXXXXXXXX",
        },
      },
    ]

    beforeAll(() => useBee(makeBee(buildSubs(PII_RECORDS, { indexed: false }))))

    it("strips the raw survey bag but promotes name + coords to typed public fields", async () => {
      const res = await api.get("/web/census/weavers?census_id=30", {
        validateStatus: () => true,
      })
      expect(res.status).toBe(200)
      const w = res.data.weaver
      // survey bag (exact coords / PIN / income re-dump) is gone…
      expect(w.survey).toBeUndefined()
      // …but the public display fields are promoted to typed keys.
      expect(w.name).toBe("MOHD SHAHID")
      expect(w.latitude).toBe(27.2823364)
      expect(w.longitude).toBe(81.1697055)
    })

    it("drops raw contact/identity values, keeps the masked + verified signals", async () => {
      const res = await api.get("/web/census/weavers?census_id=30", {
        validateStatus: () => true,
      })
      const w = res.data.weaver
      for (const k of [
        "mobile", "aadhaar_number", "pan", "bank_account", "ifsc", "father_husband_name",
      ]) {
        expect(w[k]).toBeUndefined()
      }
      // the "verified" signals the UI renders are intentionally preserved
      expect(w.mobile_masked).toBe("91XXXXXXXXXX")
      expect(w.aadhaar_card_available).toBe(true)
      expect(w.voter_id_available).toBe(true)
    })

    it("masks every row in a browse list too (no survey leaks through the scan)", async () => {
      const res = await api.get("/web/census/weavers?state=UTTAR PRADESH", {
        validateStatus: () => true,
      })
      expect(res.status).toBe(200)
      expect(res.data.weavers.length).toBeGreaterThan(0)
      for (const w of res.data.weavers) {
        expect(w.survey).toBeUndefined()
        expect(w.mobile).toBeUndefined()
        expect(w.aadhaar_number).toBeUndefined()
      }
    })
  })
})
