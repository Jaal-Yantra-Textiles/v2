import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"

const TEST_PARTNER_PASSWORD = "supersecret"

jest.setTimeout(90 * 1000)

async function createPartnerWithStore(api: any, adminHeaders: Record<string, any>) {
  const unique = Date.now() + Math.random().toString(36).slice(2, 6)
  const email = `partner-ak-${unique}@medusa-test.com`

  await api.post("/auth/partner/emailpass/register", { email, password: TEST_PARTNER_PASSWORD })
  const login1 = await api.post("/auth/partner/emailpass", { email, password: TEST_PARTNER_PASSWORD })
  let headers: Record<string, string> = { Authorization: `Bearer ${login1.data.token}` }

  const partnerRes = await api.post(
    "/partners",
    {
      name: `AKTest ${unique}`,
      handle: `aktest-${unique}`,
      admin: { email, first_name: "Admin", last_name: "AK" },
    },
    { headers }
  )
  const partnerId = partnerRes.data.partner.id

  const login2 = await api.post("/auth/partner/emailpass", { email, password: TEST_PARTNER_PASSWORD })
  headers = { Authorization: `Bearer ${login2.data.token}` }

  const currenciesRes = await api.get("/admin/currencies", adminHeaders)
  const currencies = currenciesRes.data.currencies || []
  const usd = currencies.find((c: any) => c.code?.toLowerCase() === "usd")
  const currencyCode = String((usd || currencies[0]).code).toLowerCase()

  const storeRes = await api.post(
    "/partners/stores",
    {
      store: {
        name: `AKStore ${unique}`,
        supported_currencies: [{ currency_code: currencyCode, is_default: true }],
      },
      region: { name: "Default Region", currency_code: currencyCode, countries: ["us"] },
      location: {
        name: "Warehouse",
        address: { address_1: "1 Main St", city: "NY", postal_code: "10001", country_code: "US" },
      },
    },
    { headers }
  )

  return {
    headers,
    partnerId,
    storeId: storeRes.data.store.id,
    salesChannelId: storeRes.data.sales_channel?.id,
  }
}

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Partner API - API Keys", () => {
    let adminHeaders: Record<string, any>
    let partner: Awaited<ReturnType<typeof createPartnerWithStore>>

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)
      partner = await createPartnerWithStore(api, adminHeaders)
    })

    describe("GET /partners/api-keys", () => {
      it("should list API keys for the partner", async () => {
        const res = await api.get("/partners/api-keys", {
          headers: partner.headers,
        })
        expect(res.status).toBe(200)
        expect(Array.isArray(res.data.api_keys)).toBe(true)
        // Store creation auto-creates a publishable API key
        expect(res.data.api_keys.length).toBeGreaterThanOrEqual(1)
      })
    })

    describe("POST /partners/api-keys", () => {
      it("should create a new publishable API key", async () => {
        const res = await api.post(
          "/partners/api-keys",
          { title: "My Custom Key" },
          { headers: partner.headers }
        )
        expect(res.status).toBe(201)
        expect(res.data.api_key).toBeDefined()
        expect(res.data.api_key.title).toBe("My Custom Key")
      })
    })

    describe("API Key CRUD", () => {
      let apiKeyId: string

      beforeEach(async () => {
        const res = await api.post(
          "/partners/api-keys",
          { title: "Test Key" },
          { headers: partner.headers }
        )
        apiKeyId = res.data.api_key.id
      })

      it("GET /partners/api-keys/:id returns the key", async () => {
        const res = await api.get(`/partners/api-keys/${apiKeyId}`, {
          headers: partner.headers,
        })
        expect(res.status).toBe(200)
        expect(res.data.api_key.id).toBe(apiKeyId)
        expect(res.data.api_key.title).toBe("Test Key")
      })

      it("POST /partners/api-keys/:id updates the key title", async () => {
        const res = await api.post(
          `/partners/api-keys/${apiKeyId}`,
          { title: "Updated Key" },
          { headers: partner.headers }
        )
        expect(res.status).toBe(200)
        expect(res.data.api_key.title).toBe("Updated Key")
      })

      it("POST /partners/api-keys/:id/revoke revokes the key", async () => {
        const res = await api.post(
          `/partners/api-keys/${apiKeyId}/revoke`,
          {},
          { headers: partner.headers }
        )
        expect(res.status).toBe(200)
        expect(res.data.api_key).toBeDefined()
        expect(res.data.api_key.revoked_at).toBeDefined()
      })

      it("DELETE /partners/api-keys/:id deletes the key", async () => {
        const res = await api.delete(`/partners/api-keys/${apiKeyId}`, {
          headers: partner.headers,
        })
        expect(res.status).toBe(200)
        expect(res.data.deleted).toBe(true)

        // Verify it's gone from the list
        const listRes = await api.get("/partners/api-keys", {
          headers: partner.headers,
        })
        const found = listRes.data.api_keys.some((k: any) => k.id === apiKeyId)
        expect(found).toBe(false)
      })
    })

    describe("API Key Sales Channel Linking", () => {
      it("should link sales channels to an API key", async () => {
        // Create a new API key
        const keyRes = await api.post(
          "/partners/api-keys",
          { title: "Channel Key" },
          { headers: partner.headers }
        )
        const apiKeyId = keyRes.data.api_key.id

        // Get partner sales channels
        const storesRes = await api.get("/partners/stores", {
          headers: partner.headers,
        })
        const store = storesRes.data.stores?.[0]
        if (!store?.default_sales_channel_id) return

        const res = await api.post(
          `/partners/api-keys/${apiKeyId}/sales-channels`,
          { add: [store.default_sales_channel_id] },
          { headers: partner.headers }
        )
        expect(res.status).toBe(200)
        expect(res.data.api_key).toBeDefined()
      })
    })
  })
})
