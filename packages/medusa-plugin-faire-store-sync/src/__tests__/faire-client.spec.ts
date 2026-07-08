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
    expect(DEFAULT_API_BASE).toBe("https://faire.com/external-api/v2")
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
    await c.updateInventory("t", [{ sku: "S1", current_count: 7 }])
    expect(lastInit.method).toBe("PATCH")
    expect(lastUrl).toBe(`${DEFAULT_API_BASE}/product-inventory/by-skus`)
    expect(JSON.parse(lastInit.body)).toEqual({
      inventories: [{ sku: "S1", current_count: 7 }],
    })
  })

  it("lists orders with cursor page + updated_at_min", async () => {
    const c = new FaireClient(oauthOpts)
    await c.listOrders("t", { page: "cursor-xyz", updated_at_min: "2026-01-01T00:00:00Z" })
    const url = new URL(lastUrl)
    expect(url.pathname).toBe("/external-api/v2/orders")
    expect(url.searchParams.get("page")).toBe("cursor-xyz")
    expect(url.searchParams.get("updated_at_min")).toBe("2026-01-01T00:00:00Z")
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
