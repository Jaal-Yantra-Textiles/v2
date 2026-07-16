import { brotliCompressSync } from "node:zlib"

import { censusReader } from "../../src/modules/census/reader"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(60 * 1000)

// Masked public records the fake P2P core serves. Keyed by census_id (as the
// real `rec/<id>` sub is), so both the keyed single-record get and the full
// scan resolve against the same data.
const RECORDS: Record<string, Record<string, any>> = {
  "1": { census_id: 1, state: "HARYANA", district: "PANIPAT", gender: "Female" },
  "2": { census_id: 2, state: "HARYANA", district: "SONIPAT", gender: "Male" },
  "3": { census_id: 3, state: "PUNJAB", district: "AMRITSAR", gender: "Female" },
}

const enc = (r: Record<string, any>) => brotliCompressSync(Buffer.from(JSON.stringify(r)))

// Minimal Hyperbee stand-in matching the shape reader.ts depends on (`sub` →
// `get` + `createReadStream`). Lets the route exercise the real reader/service
// path without the native hypercore stack or a live swarm peer.
function makeFakeBee() {
  const recSub = {
    async get(key: string) {
      const r = RECORDS[key]
      return r ? { value: enc(r) } : null
    },
    async *createReadStream() {
      for (const [key, r] of Object.entries(RECORDS)) {
        yield { key, value: enc(r) }
      }
    },
  }
  return {
    sub(prefix: string) {
      if (prefix === "rec") return recSub
      // agg / others unused by these tests
      return { get: async () => null, createReadStream: async function* () {} }
    },
  }
}

setupSharedTestSuite(() => {
  const api = getSharedTestEnv().api

  beforeAll(() => {
    // The test env may configure CENSUS_READER_URL → the loader boots the reader
    // in PROXY mode, which takes precedence over an embedded bee. Clear it so the
    // fake in-process core below is actually exercised.
    ;(censusReader as any).proxyUrl = null
    censusReader.setBee(makeFakeBee() as any)
  })

  describe("GET /web/census/weavers", () => {
    // Regression: census_id was not in the FILTERABLE whitelist, so it was
    // silently dropped and the route returned page-one of *all* weavers
    // instead of the requested record.
    it("resolves a single record by census_id via the keyed get", async () => {
      const res = await api.get("/web/census/weavers?census_id=2", {
        validateStatus: () => true,
      })

      expect(res.status).toBe(200)
      expect(res.data.weaver).toMatchObject({ census_id: 2, district: "SONIPAT" })
      // single-record shape — not the paginated list envelope
      expect(res.data.weavers).toBeUndefined()
      expect(res.data.count).toBeUndefined()
    })

    it("returns 404 for an unknown census_id", async () => {
      const res = await api.get("/web/census/weavers?census_id=999", {
        validateStatus: () => true,
      })

      expect(res.status).toBe(404)
    })

    it("still filters the paginated list when no census_id is given", async () => {
      const res = await api.get("/web/census/weavers?state=HARYANA", {
        validateStatus: () => true,
      })

      expect(res.status).toBe(200)
      expect(res.data.count).toBe(2)
      expect(res.data.weavers).toHaveLength(2)
      expect(res.data.weavers.every((w: any) => w.state === "HARYANA")).toBe(true)
    })
  })
})
