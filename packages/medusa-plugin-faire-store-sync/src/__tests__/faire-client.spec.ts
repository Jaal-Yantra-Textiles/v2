import { FaireClient, FaireApiError } from "../lib/faire-client"
import { DEFAULT_API_BASE, DEFAULT_AUTH_URL, DEFAULT_TOKEN_URL } from "../lib/types"

// Capture the last fetch call (url, init).
let lastUrl: string
let lastInit: any
const fetchMock = jest.fn(async (url: string, init: any) => {
  lastUrl = url
  lastInit = init
  return {
    ok: true,
    status: 200,
    headers: new Map(),
    text: async () => JSON.stringify({ access_token: "tok", brand_id: "b_1", name: "Acme" }),
  } as any
})

// Shared taxonomy types fixture (matches the shape Faire returns).
const taxonomyTypes = [
  { id: "tt_1", name: "Apparel" },
  { id: "tt_2", name: "Accessories" },
  { id: "tt_3", name: "Home & Living" },
  { id: "tt_4", name: "Dresses" },
  { id: "tt_5", name: "Address Book" },
]

;(global as any).fetch = fetchMock

const oauthOpts = {
  authMode: "oauth" as const,
  clientId: "app_123",
  clientSecret: "secret_456",
  redirectUri: "https://shop.test/app/settings/oauth/faire/callback",
}

describe("FaireClient — issue #952 corrections", () => {
  beforeEach(() => fetchMock.mockClear())

  it("uses the verified base / auth / token URLs by default", () => {
    const c = new FaireClient({})
    // defaults are exported from types and consumed verbatim
    expect(DEFAULT_API_BASE).toBe("https://www.faire.com/external-api/v2")
    expect(DEFAULT_AUTH_URL).toBe("https://faire.com/oauth2/authorize")
    expect(DEFAULT_TOKEN_URL).toBe("https://www.faire.com/api/external-api-oauth2/token")
  })

  it("builds the authorize URL with Faire's applicationId/redirectUrl params", () => {
    const c = new FaireClient(oauthOpts)
    const url = new URL(c.getAuthorizationUrl("state-abc"))
    expect(url.origin + url.pathname).toBe("https://faire.com/oauth2/authorize")
    expect(url.searchParams.get("applicationId")).toBe("app_123")
    expect(url.searchParams.get("redirectUrl")).toBe(oauthOpts.redirectUri)
    expect(url.searchParams.get("state")).toBe("state-abc")
    // MUST NOT use RFC-6749 client_id/redirect_uri
    expect(url.searchParams.has("client_id")).toBe(false)
    expect(url.searchParams.has("redirect_uri")).toBe(false)
  })

  it("exchanges code with a NON-RFC-6749 JSON body", async () => {
    const c = new FaireClient(oauthOpts)
    await c.exchangeCodeForToken("code_xyz")
    expect(lastUrl).toBe(DEFAULT_TOKEN_URL)
    expect(lastInit.method).toBe("POST")
    expect(lastInit.headers["Content-Type"]).toBe("application/json")
    const body = JSON.parse(lastInit.body)
    expect(body).toMatchObject({
      application_token: "app_123",
      application_secret: "secret_456",
      authorization_code: "code_xyz",
      grant_type: "AUTHORIZATION_CODE",
      redirect_url: oauthOpts.redirectUri,
    })
    expect(body.scope).toEqual([])
    // MUST NOT send RFC-6749 fields
    expect(body.client_id).toBeUndefined()
    expect(body.client_secret).toBeUndefined()
  })

  it("sends OAuth auth headers (X-FAIRE-OAUTH-ACCESS-TOKEN + APP-CREDENTIALS), never Bearer", async () => {
    const c = new FaireClient(oauthOpts)
    await c.getBrand("access-tok")
    expect(lastUrl).toBe(`${DEFAULT_API_BASE}/brands/profile`)
    expect(lastInit.headers["X-FAIRE-OAUTH-ACCESS-TOKEN"]).toBe("access-tok")
    const expectedCreds = Buffer.from("app_123:secret_456").toString("base64")
    expect(lastInit.headers["X-FAIRE-APP-CREDENTIALS"]).toBe(expectedCreds)
    expect(lastInit.headers["Authorization"]).toBeUndefined()
  })

  it("sends API-key auth header (X-FAIRE-ACCESS-TOKEN) in apiKey mode", async () => {
    const c = new FaireClient({ authMode: "apiKey", accessToken: "key_abc" })
    // In apiKey mode the stored account access_token IS the api key.
    await c.getBrand("key_abc")
    expect(lastInit.headers["X-FAIRE-ACCESS-TOKEN"]).toBe("key_abc")
    expect(lastInit.headers["X-FAIRE-OAUTH-ACCESS-TOKEN"]).toBeUndefined()
    expect(lastInit.headers["Authorization"]).toBeUndefined()
  })

  it("hits /brands/profile (NOT /brand)", async () => {
    const c = new FaireClient(oauthOpts)
    await c.getBrand("t")
    expect(lastUrl).toBe(`${DEFAULT_API_BASE}/brands/profile`)
  })

  it("pushes inventory via PATCH /product-inventory/by-skus (not GET /inventory)", async () => {
    const c = new FaireClient(oauthOpts)
    await c.updateInventory("t", [{ sku: "S1", on_hand_quantity: 7 }])
    expect(lastInit.method).toBe("PATCH")
    expect(lastUrl).toBe(`${DEFAULT_API_BASE}/product-inventory/by-skus`)
    expect(JSON.parse(lastInit.body)).toEqual({
      inventories: [{ sku: "S1", on_hand_quantity: 7 }],
    })
  })

  it("lists orders with numeric page + updated_at_min", async () => {
    const c = new FaireClient(oauthOpts)
    await c.listOrders("t", { page: "2", updated_at_min: "2026-01-01T00:00:00Z" })
    const url = new URL(lastUrl)
    expect(url.pathname).toBe("/external-api/v2/orders")
    expect(url.searchParams.get("page")).toBe("2")
    expect(url.searchParams.get("updated_at_min")).toBe("2026-01-01T00:00:00Z")
  })

  it("derives next_page from numeric page (Faire returns no cursor)", async () => {
    const c = new FaireClient(oauthOpts)
    const page = (rows: number) => ({
      ok: true,
      status: 200,
      headers: new Map(),
      text: async () =>
        JSON.stringify({
          page: undefined,
          orders: Array.from({ length: rows }, (_, i) => ({ id: `bo_${i}` })),
        }),
    })
    // A full page (rows === limit) → there may be more → next_page = current+1.
    fetchMock.mockImplementationOnce(async () => page(2) as any)
    const full = await c.listOrders("t", { limit: 2, page: "1" })
    expect(full.next_page).toBe("2")
    // A short page → last page → no next_page.
    fetchMock.mockImplementationOnce(async () => page(1) as any)
    const short = await c.listOrders("t", { limit: 2, page: "2" })
    expect(short.next_page).toBeUndefined()
  })

  it("posts order processing (PUT) and shipments (POST) on the right paths", async () => {
    const c = new FaireClient(oauthOpts)
    await c.setOrderProcessing("t", "o_1", { accepted: true })
    expect(lastInit.method).toBe("PUT")
    expect(lastUrl).toBe(`${DEFAULT_API_BASE}/orders/o_1/processing`)

    await c.createOrderShipment("t", "o_1", { carrier: "UPS", tracking: "1Z" })
    expect(lastInit.method).toBe("POST")
    expect(lastUrl).toBe(`${DEFAULT_API_BASE}/orders/o_1/shipments`)
  })

  it("surfaces 401 as FaireApiError", async () => {
    fetchMock.mockImplementationOnce(async () => ({
      ok: false,
      status: 401,
      headers: new Map(),
      text: async () => "",
    } as any))
    const c = new FaireClient(oauthOpts)
    await expect(c.getBrand("t")).rejects.toMatchObject({
      name: "FaireApiError",
      status: 401,
    })
  })
})

describe("FaireClient.resolveTaxonomyTypeId", () => {
  beforeEach(() => {
    fetchMock.mockClear()
    // Reset the cache on each test by creating a fresh client.
  })

  it("passes a tt_ id straight through without an API call", async () => {
    const c = new FaireClient(oauthOpts)
    const result = await c.resolveTaxonomyTypeId("tok", "tt_abc123")
    expect(result).toBe("tt_abc123")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("returns null for empty / falsy input", async () => {
    const c = new FaireClient(oauthOpts)
    await expect(c.resolveTaxonomyTypeId("tok", "")).resolves.toBeNull()
    await expect(c.resolveTaxonomyTypeId("tok", "")).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("fetches taxonomy types on first call, caches, and resolves by exact name", async () => {
    fetchMock.mockImplementationOnce(async () => ({
      ok: true,
      status: 200,
      headers: new Map(),
      text: async () => JSON.stringify({ taxonomy_types: taxonomyTypes }),
    } as any))
    const c = new FaireClient(oauthOpts)
    const result = await c.resolveTaxonomyTypeId("tok", "Dresses")
    expect(result).toBe("tt_4")
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const callUrl = fetchMock.mock.calls[0][0] as string
    expect(callUrl).toContain("/products/types")

    // Second call uses the cache — no additional fetch.
    const cached = await c.resolveTaxonomyTypeId("tok", "Accessories")
    expect(cached).toBe("tt_2")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("prefers whole-word match over loose substring (Dress vs Address Book)", async () => {
    fetchMock.mockImplementationOnce(async () => ({
      ok: true,
      status: 200,
      headers: new Map(),
      text: async () => JSON.stringify({ taxonomy_types: taxonomyTypes }),
    } as any))
    const c = new FaireClient(oauthOpts)
    // "Dress" should match "Dresses" (word-boundary) not "Address Book".
    const result = await c.resolveTaxonomyTypeId("tok", "Dress")
    expect(result).toBe("tt_4")
  })

  it("falls back to substring match when whole-word finds nothing", async () => {
    fetchMock.mockImplementationOnce(async () => ({
      ok: true,
      status: 200,
      headers: new Map(),
      text: async () => JSON.stringify({ taxonomy_types: taxonomyTypes }),
    } as any))
    const c = new FaireClient(oauthOpts)
    // "ccessori" is not a whole word but a substring of "Accessories".
    const result = await c.resolveTaxonomyTypeId("tok", "ccessori")
    expect(result).toBe("tt_2")
  })

  it("returns null when no taxonomy type matches — the condition that triggers the MedusaError", async () => {
    fetchMock.mockImplementationOnce(async () => ({
      ok: true,
      status: 200,
      headers: new Map(),
      text: async () => JSON.stringify({ taxonomy_types: taxonomyTypes }),
    } as any))
    const c = new FaireClient(oauthOpts)
    const result = await c.resolveTaxonomyTypeId("tok", "NonExistentCategory")
    expect(result).toBeNull()
  })

  it("handles alternate response shapes (product_types / types / results)", async () => {
    for (const key of ["product_types", "types", "results"]) {
      fetchMock.mockImplementationOnce(async () => ({
        ok: true,
        status: 200,
        headers: new Map(),
        text: async () => JSON.stringify({ [key]: taxonomyTypes }),
      } as any))
    }
    const c = new FaireClient(oauthOpts)
    // Each call should reset the cache because we used a fresh client.
    const c1 = new FaireClient(oauthOpts)
    expect(await c1.resolveTaxonomyTypeId("tok", "Apparel")).toBe("tt_1")
    const c2 = new FaireClient(oauthOpts)
    expect(await c2.resolveTaxonomyTypeId("tok", "Accessories")).toBe("tt_2")
    const c3 = new FaireClient(oauthOpts)
    expect(await c3.resolveTaxonomyTypeId("tok", "Home & Living")).toBe("tt_3")
  })
})
