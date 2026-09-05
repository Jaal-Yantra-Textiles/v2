import { brotliCompressSync } from "node:zlib"

import { censusReader } from "../../src/modules/census/reader"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(90000)

const enc = (r: Record<string, any>) => brotliCompressSync(Buffer.from(JSON.stringify(r)))
const padId = (id: string | number) => String(id).padStart(10, "0")

// Minimal in-memory Hyperbee stand-in (rec + agg + idx + meta) so the reader
// exercises its indexed fast path without the native hypercore stack.
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
        async *createReadStream(range?: { gte?: string; gt?: string; lt?: string; lte?: string }) {
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

const RECORDS = [
  {
    census_id: 1,
    state: "KARNATAKA",
    district: "BAGALKOT",
    gender: "Male",
    education: "Middle",
    survey: { Name: "Ramesh Patel", Latitude: "16.1", Longitude: "75.1" },
  },
  {
    census_id: 2,
    state: "KARNATAKA",
    district: "BELGAUM",
    gender: "Female",
    education: "Primary",
    survey: { Name: "Sunita Devi", Latitude: "16.2", Longitude: "75.2" },
  },
]

function buildSubs(records: Array<Record<string, any>>) {
  const rec: Array<[string, any]> = records.map((r) => [String(r.census_id), enc(r)])

  const agg = new Map<string, number>()
  const bump = (k: string) => agg.set(k, (agg.get(k) || 0) + 1)
  for (const r of records) {
    bump(`total/weavers`)
    bump(`state/${r.state}`)
    bump(`gender/${r.gender}`)
    bump(`district/${r.state}|${r.district}`)
  }

  const idx: Array<[string, any]> = []
  for (const r of records) {
    const p = padId(r.census_id)
    idx.push([`all/${p}`, Buffer.from("")])
    idx.push([`state/${r.state}/${p}`, Buffer.from("")])
    idx.push([`gender/${r.gender}/${p}`, Buffer.from("")])
    idx.push([`sd/${r.state}|${r.district}/${p}`, Buffer.from("")])
  }

  return {
    rec,
    agg: [...agg].map(([k, v]) => [k, String(v)]),
    idx,
    meta: [["idx-version", "idx-v1"], ["idx-all-version", "idxall-v1"]],
  } as Record<string, Array<[string, any]>>
}

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()
  let headers: any

  beforeAll(() => {
    ;(censusReader as any).proxyUrl = null
    censusReader.setBee(makeBee(buildSubs(RECORDS)))
  })

  beforeEach(async () => {
    const container = getContainer()
    await createAdminUser(container)
    headers = await getAuthHeaders(api)
  })

  describe("GET /admin/persons — include weavers (census node)", () => {
    it("returns masked census weavers alongside persons when include_weavers=true", async () => {
      const res = await api.get("/admin/persons?include_weavers=true&limit=10&offset=0", headers)

      expect(res.status).toBe(200)
      expect(res.data.census_connected).toBe(true)
      expect(Array.isArray(res.data.weavers)).toBe(true)
      expect(res.data.weavers_count).toBe(2)
      expect(res.data.weavers.map((w: any) => w.census_id).sort()).toEqual([1, 2])
      for (const w of res.data.weavers) {
        expect(w.survey).toBeUndefined() // raw survey bag stripped
        expect(typeof w.name).toBe("string") // display name promoted
      }
    })

    it("omits weavers when include_weavers is false", async () => {
      const res = await api.get("/admin/persons?limit=10&offset=0", headers)

      expect(res.status).toBe(200)
      expect(res.data.weavers).toBeUndefined()
      expect(res.data.weavers_count).toBeUndefined()
    })

    it("filters weavers by name (q) and district", async () => {
      const res = await api.get(
        "/admin/persons?include_weavers=true&q=ramesh&district=BAGALKOT&limit=10&offset=0",
        headers
      )

      expect(res.status).toBe(200)
      expect(res.data.weavers.map((w: any) => w.census_id)).toEqual([1])
    })

    it("maps region_state to the census geographic state", async () => {
      const res = await api.get(
        "/admin/persons?include_weavers=true&region_state=KARNATAKA&limit=10&offset=0",
        headers
      )

      expect(res.status).toBe(200)
      expect(res.data.weavers.map((w: any) => w.census_id).sort()).toEqual([1, 2])
    })
  })

  describe("GET /admin/census/weavers/:census_id/unmask — MFA gate", () => {
    it("fails closed (403) when the caller has no MFA factor", async () => {
      const res = await api
        .get("/admin/census/weavers/1/unmask", headers)
        .catch((e: any) => e.response)

      expect(res.status).toBe(403)
    })
  })
})