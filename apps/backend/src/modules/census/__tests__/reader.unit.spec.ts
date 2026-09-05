import { createServer } from "node:http"

import { matchesWeaverFilters, censusReader } from "../reader"

describe("matchesWeaverFilters", () => {
  const rec = {
    census_id: 42,
    name: "Mohd Shahid",
    state: "UTTAR PRADESH",
    district: "SITAPUR",
    gender: "Male",
    own_looms: true,
  }

  it("matches exact equality on ordinary fields", () => {
    expect(matchesWeaverFilters(rec, { state: "UTTAR PRADESH" })).toBe(true)
    expect(matchesWeaverFilters(rec, { state: "KARNATAKA" })).toBe(false)
    expect(matchesWeaverFilters(rec, { own_looms: true })).toBe(true)
    expect(matchesWeaverFilters(rec, { own_looms: false })).toBe(false)
  })

  it("matches `name` as a case-insensitive substring", () => {
    expect(matchesWeaverFilters(rec, { name: "shahid" })).toBe(true)
    expect(matchesWeaverFilters(rec, { name: "MOHD" })).toBe(true)
    expect(matchesWeaverFilters(rec, { name: "Kumar" })).toBe(false)
  })

  it("treats an empty `name` needle as no constraint", () => {
    expect(matchesWeaverFilters(rec, { name: "" })).toBe(true)
    expect(matchesWeaverFilters(rec, { name: "   " })).toBe(true)
  })

  it("ANDs multiple filters", () => {
    expect(matchesWeaverFilters(rec, { state: "UTTAR PRADESH", name: "shahid" })).toBe(true)
    expect(matchesWeaverFilters(rec, { state: "KARNATAKA", name: "shahid" })).toBe(false)
  })

  it("is lenient when the record lacks the name field", () => {
    expect(matchesWeaverFilters({ census_id: 1 }, { name: "x" })).toBe(false)
    expect(matchesWeaverFilters({ census_id: 1 }, { name: "" })).toBe(true)
  })
})

describe("CensusReader.unmaskWeaver (proxy path)", () => {
  const realFetch = globalThis.fetch
  const prevProxy = (censusReader as any).proxyUrl
  const prevToken = process.env.CENSUS_UNMASK_TOKEN

  afterAll(() => {
    globalThis.fetch = realFetch
    ;(censusReader as any).proxyUrl = prevProxy
    if (prevToken === undefined) delete process.env.CENSUS_UNMASK_TOKEN
    else process.env.CENSUS_UNMASK_TOKEN = prevToken
  })

  it("sends the bearer token and returns the full record", async () => {
    ;(censusReader as any).proxyUrl = "http://node"
    process.env.CENSUS_UNMASK_TOKEN = "sekret"
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ weaver: { census_id: 1, mobile: "9812345678" } }),
    }) as any

    const out = await censusReader.unmaskWeaver(1)
    expect(out).toEqual({ census_id: 1, mobile: "9812345678" })
    expect(globalThis.fetch).toHaveBeenCalledWith("http://node/census/unmask/1", {
      headers: { accept: "application/json", authorization: "Bearer sekret" },
    })
  })

  it("returns null on 404", async () => {
    ;(censusReader as any).proxyUrl = "http://node"
    process.env.CENSUS_UNMASK_TOKEN = "sekret"
    globalThis.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 }) as any
    await expect(censusReader.unmaskWeaver(999)).resolves.toBeNull()
  })

  it("throws on 401 (token mismatch)", async () => {
    ;(censusReader as any).proxyUrl = "http://node"
    process.env.CENSUS_UNMASK_TOKEN = "sekret"
    globalThis.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401 }) as any
    await expect(censusReader.unmaskWeaver(1)).rejects.toThrow(/unauthorized/)
  })

  it("throws when no token is configured", async () => {
    ;(censusReader as any).proxyUrl = "http://node"
    delete process.env.CENSUS_UNMASK_TOKEN
    await expect(censusReader.unmaskWeaver(1)).rejects.toThrow(/CENSUS_UNMASK_TOKEN/)
  })

  it("throws in embedded mode (no proxy)", async () => {
    ;(censusReader as any).proxyUrl = null
    process.env.CENSUS_UNMASK_TOKEN = "sekret"
    await expect(censusReader.unmaskWeaver(1)).rejects.toThrow(/embedded mode/)
  })
})

// Real-HTTP round trip: a live local server plays the OCI node's
// token-gated /census/unmask/:id contract, and the reader talks to it with the
// REAL global fetch (no jest.fn). Proves the URL/header/status contract the node
// implements matches what the reader sends.
describe("CensusReader.unmaskWeaver against a real HTTP node", () => {
  let server: ReturnType<typeof createServer>
  let url = ""
  const TOKEN = "test-token"
  const prevProxy = (censusReader as any).proxyUrl
  const prevToken = process.env.CENSUS_UNMASK_TOKEN

  beforeAll(async () => {
    server = createServer((req, res) => {
      const m = (req.url || "").match(/^\/census\/unmask\/(.+)$/)
      if (!m) {
        res.writeHead(404).end()
        return
      }
      if (req.headers["authorization"] !== `Bearer ${TOKEN}`) {
        res.writeHead(401, { "content-type": "application/json" })
        res.end(JSON.stringify({ message: "unauthorized" }))
        return
      }
      const id = decodeURIComponent(m[1])
      if (id === "999") {
        res.writeHead(404, { "content-type": "application/json" })
        res.end(JSON.stringify({ message: "not found" }))
        return
      }
      res.writeHead(200, { "content-type": "application/json" })
      res.end(
        JSON.stringify({
          weaver: { census_id: id, name: "Real Name", mobile: "9812345678", religion: "Hindu", social_group: "OBC" },
        })
      )
    })
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()))
    const addr = server.address()
    url = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`
  })

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()))
    ;(censusReader as any).proxyUrl = prevProxy
    if (prevToken === undefined) delete process.env.CENSUS_UNMASK_TOKEN
    else process.env.CENSUS_UNMASK_TOKEN = prevToken
  })

  it("round-trips the full record with the bearer", async () => {
    ;(censusReader as any).proxyUrl = url
    process.env.CENSUS_UNMASK_TOKEN = TOKEN
    const out = await censusReader.unmaskWeaver(42)
    expect(out).toEqual({
      census_id: "42",
      name: "Real Name",
      mobile: "9812345678",
      religion: "Hindu",
      social_group: "OBC",
    })
  })

  it("throws on a token mismatch (401)", async () => {
    ;(censusReader as any).proxyUrl = url
    process.env.CENSUS_UNMASK_TOKEN = "wrong-token"
    await expect(censusReader.unmaskWeaver(42)).rejects.toThrow(/unauthorized/)
  })

  it("returns null for an unknown id (404)", async () => {
    ;(censusReader as any).proxyUrl = url
    process.env.CENSUS_UNMASK_TOKEN = TOKEN
    await expect(censusReader.unmaskWeaver(999)).resolves.toBeNull()
  })
})