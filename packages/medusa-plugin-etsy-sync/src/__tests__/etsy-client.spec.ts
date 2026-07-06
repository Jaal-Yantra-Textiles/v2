import { EtsyClient, EtsyApiError } from "../lib/etsy-client"

const opts = {
  keystring: "keystring123",
  sharedSecret: "secret456",
  redirectUri: "https://example.com/app/settings/oauth/etsy/callback",
  scope: "listings_r listings_w shops_r",
}

const mockFetch = (response: any, opts: { status?: number; headers?: Record<string, string> } = {}) => {
  const status = opts.status ?? 200
  const headers = opts.headers ?? {}
  return jest.fn().mockResolvedValue({
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (k: string) => headers[k.toLowerCase()] ?? null,
    },
    text: async () => (typeof response === "string" ? response : JSON.stringify(response)),
  } as any)
}

describe("EtsyClient", () => {
  let client: EtsyClient

  beforeEach(() => {
    client = new EtsyClient(opts)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe("auth headers", () => {
    it("sends x-api-key as keystring:sharedSecret (the bug in the old client)", async () => {
      const fetchMock = mockFetch({ results: [] })
      global.fetch = fetchMock as any

      await client.getSellerTaxonomyNodes()

      const call = fetchMock.mock.calls[0]
      const headers = (call[1] as any).headers
      expect(headers["x-api-key"]).toBe("keystring123:secret456")
      expect(headers["Authorization"]).toBeUndefined()
    })

    it("sends Bearer access token + x-api-key on scoped requests", async () => {
      const fetchMock = mockFetch({ results: [] })
      global.fetch = fetchMock as any

      await client.getListingsByShop("token123.abc", "999")

      const call = fetchMock.mock.calls[0]
      const headers = (call[1] as any).headers
      expect(headers["x-api-key"]).toBe("keystring123:secret456")
      expect(headers["Authorization"]).toBe("Bearer token123.abc")
    })
  })

  describe("PKCE + OAuth", () => {
    it("generates a verifier/challenge pair (S256)", () => {
      const { code_verifier, code_challenge } = EtsyClient.generatePkce()
      expect(code_verifier.length).toBeGreaterThanOrEqual(43)
      expect(code_challenge).not.toBe(code_verifier)
      expect(code_challenge).toMatch(/^[A-Za-z0-9_-]+$/)
    })

    it("builds the authorize URL with PKCE + state", () => {
      const url = client.getAuthorizationUrl("mystate", "challenge123")
      expect(url).toContain("https://www.etsy.com/oauth/connect")
      expect(url).toContain("client_id=keystring123")
      expect(url).toContain("state=mystate")
      expect(url).toContain("code_challenge=challenge123")
      expect(url).toContain("code_challenge_method=S256")
      expect(url).toContain("redirect_uri=https%3A%2F%2Fexample.com%2Fapp%2Fsettings%2Foauth%2Fetsy%2Fcallback")
    })

    it("exchanges code for token (form-urlencoded, no x-api-key on token endpoint)", async () => {
      const fetchMock = mockFetch({
        access_token: "111111.token",
        refresh_token: "111111.refresh",
        token_type: "Bearer",
        expires_in: 3600,
      })
      global.fetch = fetchMock as any

      const token = await client.exchangeCodeForToken("thecode", "verifier")

      expect(token.access_token).toBe("111111.token")
      expect(token.refresh_token).toBe("111111.refresh")

      const [url, init] = fetchMock.mock.calls[0] as any
      expect(url).toBe("https://api.etsy.com/v3/public/oauth/token")
      expect(init.method).toBe("POST")
      expect(init.headers["Content-Type"]).toBe("application/x-www-form-urlencoded")
      // Token endpoint must NOT carry x-api-key per auth flag
      expect(init.headers["x-api-key"]).toBeUndefined()
      expect(init.body).toContain("grant_type=authorization_code")
      expect(init.body).toContain("code_verifier=verifier")
      expect(init.body).toContain("code=thecode")
    })

    it("refreshes the access token (rotates refresh token)", async () => {
      const fetchMock = mockFetch({
        access_token: "111111.newtoken",
        refresh_token: "111111.newrefresh",
        token_type: "Bearer",
        expires_in: 3600,
      })
      global.fetch = fetchMock as any

      const token = await client.refreshAccessToken("oldrefresh")
      expect(token.access_token).toBe("111111.newtoken")
      expect(token.refresh_token).toBe("111111.newrefresh")
      expect(fetchMock.mock.calls[0][1].body).toContain("grant_type=refresh_token")
    })
  })

  describe("shop resolution", () => {
    it("extracts user_id from the token prefix and calls getShopByOwnerUserId", async () => {
      const fetchMock = mockFetch({
        results: [
          { shop_id: 999, shop_name: "MyShop", url: "u", currency_code: "USD" },
        ],
      })
      global.fetch = fetchMock as any

      const shop = await client.getShopByAccessToken("424242.sometoken")
      expect(shop.shop_id).toBe("999")
      expect(shop.shop_name).toBe("MyShop")
      expect(fetchMock.mock.calls[0][0]).toBe(
        "https://api.etsy.com/v3/application/users/424242/shops"
      )
    })

    it("resolves a shop returned directly (Etsy's real shape, no results wrapper)", async () => {
      const fetchMock = mockFetch({
        shop_id: 777,
        shop_name: "DirectShop",
        url: "u",
        currency_code: "EUR",
      })
      global.fetch = fetchMock as any

      const shop = await client.getShopByAccessToken("424242.sometoken")
      expect(shop.shop_id).toBe("777")
      expect(shop.shop_name).toBe("DirectShop")
    })

    it("throws when token has no user_id prefix", async () => {
      await expect(client.getShopByAccessToken("badtoken")).rejects.toThrow(
        /missing user_id prefix/
      )
    })
  })

  describe("createDraftListing", () => {
    it("POSTs form-urlencoded (not JSON) with legacy=true (fixes old JSON bug)", async () => {
      const fetchMock = mockFetch({
        listing_id: 42,
        state: "draft",
        title: "T",
        url: "u",
        quantity: 5,
      })
      global.fetch = fetchMock as any

      const listing = await client.createDraftListing("tok.abc", "999", {
        quantity: 5,
        title: "Test Product",
        description: "desc",
        price: 10.5,
        who_made: "i_did",
        when_made: "made_to_order",
        taxonomy_id: 1,
        tags: ["a", "b"],
      })

      expect(listing.listing_id).toBe("42")
      const [url, init] = fetchMock.mock.calls[0] as any
      expect(url).toBe(
        "https://api.etsy.com/v3/application/shops/999/listings?legacy=true"
      )
      expect(init.method).toBe("POST")
      expect(init.headers["Content-Type"]).toBe("application/x-www-form-urlencoded")
      // Required fields present in the form body
      expect(init.body).toContain("quantity=5")
      expect(init.body).toContain("title=Test+Product")
      expect(init.body).toContain("price=10.5")
      expect(init.body).toContain("who_made=i_did")
      expect(init.body).toContain("taxonomy_id=1")
      // Array tags appended as repeated keys
      expect(init.body).toMatch(/tags=a&tags=b|tags=b&tags=a/)
    })
  })

  describe("updateListing", () => {
    it("PATCHes the shop-scoped listing path (fixes old wrong path)", async () => {
      const fetchMock = mockFetch({
        listing_id: 42,
        state: "active",
        title: "T",
        url: "u",
        quantity: 5,
      })
      global.fetch = fetchMock as any

      await client.updateListing("tok.abc", "999", "42", { state: "active" })

      const [url, init] = fetchMock.mock.calls[0] as any
      expect(init.method).toBe("PATCH")
      // Old client PATCHed /listings/{id} (wrong); correct is shop-scoped
      expect(url).toBe(
        "https://api.etsy.com/v3/application/shops/999/listings/42?legacy=true"
      )
      expect(init.body).toContain("state=active")
    })
  })

  describe("uploadListingImage", () => {
    it("uploads multipart binary (fixes old image_url JSON bug)", async () => {
      const fetchMock = mockFetch({
        listing_image_id: 77,
        rank: 1,
        url_fullxfull: "https://img",
      })
      global.fetch = fetchMock as any

      const img = await client.uploadListingImage(
        "tok.abc",
        "999",
        "42",
        Buffer.from("fakeimagebytes"),
        "photo.jpg",
        { rank: 1 }
      )

      expect(img.listing_image_id).toBe("77")
      const [url, init] = fetchMock.mock.calls[0] as any
      expect(url).toBe(
        "https://api.etsy.com/v3/application/shops/999/listings/42/images"
      )
      expect(init.method).toBe("POST")
      // Must be FormData (multipart), NOT a JSON { image_url } body
      expect(init.body).toBeInstanceOf(FormData)
      expect(init.headers["Content-Type"]).toBeUndefined() // fetch sets boundary
    })
  })

  describe("rate limiting", () => {
    it("retries on 429 using retry-after then succeeds", async () => {
      const okResponse = {
        status: 200,
        ok: true,
        headers: { get: () => null },
        text: async () => JSON.stringify({ results: [], count: 0 }),
      }
      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce({
          status: 429,
          ok: false,
          headers: { get: () => "0" },
          text: async () => JSON.stringify({ error: "rate limited" }),
        } as any)
        .mockResolvedValueOnce(okResponse as any)

      global.fetch = fetchMock as any

      const result = await client.getListingsByShop("tok.abc", "999")
      expect(result.results).toEqual([])
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })
  })

  describe("error handling", () => {
    it("throws EtsyApiError with the Etsy error message on non-ok", async () => {
      const fetchMock = mockFetch({ error: "Invalid listing" }, { status: 400 })
      global.fetch = fetchMock as any

      await expect(
        client.createDraftListing("tok.abc", "999", {
          quantity: 1,
          title: "x",
          description: "",
          price: 1,
          who_made: "i_did",
          when_made: "made_to_order",
          taxonomy_id: 1,
        })
      ).rejects.toThrow(/Invalid listing/)
    })

    it("throws a 401 EtsyApiError on expired token", async () => {
      const fetchMock = mockFetch({ error: "unauthorized" }, { status: 401 })
      global.fetch = fetchMock as any

      await expect(client.getListingsByShop("tok.abc", "999")).rejects.toThrow(
        /expired or invalid/
      )
    })

    it("surfaces the Etsy detail (status + message) so a 400 is never opaque", async () => {
      const fetchMock = mockFetch(
        { error: "taxonomy_id: must be a valid taxonomy node" },
        { status: 400 }
      )
      global.fetch = fetchMock as any

      await expect(
        client.createDraftListing("tok.abc", "999", {
          quantity: 1,
          title: "x",
          description: "",
          price: 1,
          who_made: "i_did",
          when_made: "made_to_order",
          taxonomy_id: 1,
        })
      ).rejects.toThrow(/Etsy API 400: taxonomy_id/)
    })

    it("falls back to the JSON body when there is no error/message field", async () => {
      const fetchMock = mockFetch({ detail: "something odd" }, { status: 400 })
      global.fetch = fetchMock as any

      await expect(
        client.getListingsByShop("tok.abc", "999")
      ).rejects.toThrow(/something odd/)
    })
  })
})
