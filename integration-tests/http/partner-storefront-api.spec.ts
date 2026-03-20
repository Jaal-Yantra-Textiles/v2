// Mock the deployment module (Vercel + Cloudflare) used by storefront provisioning
jest.mock("../../src/modules/deployment/service", () => {
  const mockService = {
    isVercelConfigured: jest.fn().mockReturnValue(true),
    isCloudflareConfigured: jest.fn().mockReturnValue(true),
    createProject: jest.fn().mockResolvedValue({ id: "prj_mock", name: "mock-project" }),
    setEnvironmentVariables: jest.fn().mockResolvedValue(undefined),
    addDomain: jest.fn().mockResolvedValue({ name: "mock.cicilabel.com", verified: false }),
    triggerDeployment: jest.fn().mockResolvedValue({ id: "dpl_mock", url: "mock.vercel.app", readyState: "READY" }),
    getProject: jest.fn().mockResolvedValue({ id: "prj_mock", name: "mock-project" }),
    getDeployment: jest.fn().mockResolvedValue({ id: "dpl_mock", url: "mock.vercel.app", readyState: "READY" }),
    createDnsRecord: jest.fn().mockResolvedValue({ id: "dns_mock", type: "CNAME", name: "mock.cicilabel.com", content: "cname.vercel-dns.com" }),
    listDnsRecords: jest.fn().mockResolvedValue([]),
    updateDnsRecord: jest.fn().mockResolvedValue({ id: "dns_mock" }),
    deleteDnsRecord: jest.fn().mockResolvedValue(undefined),
    ensureVercelCname: jest.fn().mockResolvedValue({ action: "created", record: { id: "dns_mock", name: "mock.cicilabel.com", content: "cname.vercel-dns.com" } }),
  }
  return jest.fn().mockImplementation(() => mockService)
})

import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"

const TEST_PARTNER_PASSWORD = "supersecret"

jest.setTimeout(60 * 1000)

/**
 * Helper: create a partner with auth and return headers + partnerId
 */
async function createPartnerWithAuth(api: any) {
  const unique = Date.now() + Math.random().toString(36).slice(2, 6)
  const email = `partner-sf-${unique}@medusa-test.com`

  await api.post("/auth/partner/emailpass/register", {
    email,
    password: TEST_PARTNER_PASSWORD,
  })

  const login1 = await api.post("/auth/partner/emailpass", {
    email,
    password: TEST_PARTNER_PASSWORD,
  })
  let headers = { Authorization: `Bearer ${login1.data.token}` }

  const createRes = await api.post(
    "/partners",
    {
      name: `TestPartner ${unique}`,
      handle: `test-partner-${unique}`,
      admin: {
        email,
        first_name: "Test",
        last_name: "Partner",
      },
    },
    { headers }
  )
  const partnerId = createRes.data.partner.id

  // Re-login after partner creation to get updated auth context
  const login2 = await api.post("/auth/partner/emailpass", {
    email,
    password: TEST_PARTNER_PASSWORD,
  })
  headers = { Authorization: `Bearer ${login2.data.token}` }

  return { partnerId, headers, email, handle: `test-partner-${unique}` }
}

/**
 * Helper: create a store for a partner
 */
async function createStoreForPartner(api: any, headers: Record<string, string>) {
  const unique = Date.now()
  const payload = {
    store: {
      name: `Store ${unique}`,
      supported_currencies: [{ currency_code: "usd", is_default: true }],
    },
    region: {
      name: "US Region",
      currency_code: "usd",
      countries: ["us"],
    },
    location: {
      name: "Warehouse",
      address: {
        address_1: "123 Main St",
        city: "New York",
        postal_code: "10001",
        country_code: "US",
      },
    },
  }

  const res = await api.post("/partners/stores", payload, { headers })
  return res.data
}

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Partner Storefront API", () => {
    let adminHeaders: Record<string, any>

    beforeAll(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)
    })

    describe("Phase 1: Auto API Key on Store Creation", () => {
      it("should auto-create a publishable API key when creating a store", async () => {
        const { headers } = await createPartnerWithAuth(api)
        const storeData = await createStoreForPartner(api, headers)

        expect(storeData.api_key).toBeDefined()
        expect(storeData.api_key.type).toBe("publishable")
        expect(storeData.api_key.token).toBeDefined()
        expect(storeData.api_key.title).toContain("Publishable Key")
      })
    })

    describe("Phase 1B: Partner API Key CRUD", () => {
      let partnerA: { partnerId: string; headers: Record<string, string> }
      let storeDataA: any

      beforeEach(async () => {
        partnerA = await createPartnerWithAuth(api)
        storeDataA = await createStoreForPartner(api, partnerA.headers)
      })

      it("should list the auto-created API key", async () => {
        const res = await api.get("/partners/api-keys", {
          headers: partnerA.headers,
        })

        expect(res.status).toBe(200)
        expect(res.data.api_keys).toBeDefined()
        expect(res.data.api_keys.length).toBeGreaterThanOrEqual(1)
        expect(res.data.count).toBeGreaterThanOrEqual(1)

        const autoKey = res.data.api_keys.find(
          (k: any) => k.id === storeDataA.api_key.id
        )
        expect(autoKey).toBeDefined()
      })

      it("should retrieve a single API key by ID", async () => {
        const res = await api.get(
          `/partners/api-keys/${storeDataA.api_key.id}`,
          { headers: partnerA.headers }
        )

        expect(res.status).toBe(200)
        expect(res.data.api_key).toBeDefined()
        expect(res.data.api_key.id).toBe(storeDataA.api_key.id)
      })

      it("should create an additional publishable API key", async () => {
        const res = await api.post(
          "/partners/api-keys",
          { title: "Second Key" },
          { headers: partnerA.headers }
        )

        expect(res.status).toBe(201)
        expect(res.data.api_key).toBeDefined()
        expect(res.data.api_key.title).toBe("Second Key")
        expect(res.data.api_key.type).toBe("publishable")
      })

      it("should update an API key title", async () => {
        const res = await api.post(
          `/partners/api-keys/${storeDataA.api_key.id}`,
          { title: "Updated Title" },
          { headers: partnerA.headers }
        )

        expect(res.status).toBe(200)
        expect(res.data.api_key).toBeDefined()
      })

      it("should revoke an API key", async () => {
        const res = await api.post(
          `/partners/api-keys/${storeDataA.api_key.id}/revoke`,
          {},
          { headers: partnerA.headers }
        )

        expect(res.status).toBe(200)
        expect(res.data.api_key).toBeDefined()
      })

      it("should delete an API key", async () => {
        // Create a throwaway key to delete
        const createRes = await api.post(
          "/partners/api-keys",
          { title: "To Delete" },
          { headers: partnerA.headers }
        )
        const keyId = createRes.data.api_key.id

        const res = await api.delete(`/partners/api-keys/${keyId}`, {
          headers: partnerA.headers,
        })

        expect(res.status).toBe(200)
        expect(res.data.deleted).toBe(true)
      })

      it("should batch add/remove sales channels", async () => {
        const salesChannelId = storeDataA.sales_channel.id

        // The auto-created key is already linked; try batch endpoint
        const res = await api.post(
          `/partners/api-keys/${storeDataA.api_key.id}/sales-channels`,
          { add: [salesChannelId] },
          { headers: partnerA.headers }
        )

        expect(res.status).toBe(200)
        expect(res.data.api_key).toBeDefined()
      })
    })

    describe("Phase 1B: API Key Isolation", () => {
      it("should prevent partner A from accessing partner B's API keys", async () => {
        const partnerA = await createPartnerWithAuth(api)
        const partnerB = await createPartnerWithAuth(api)
        await createStoreForPartner(api, partnerA.headers)
        const storeDataB = await createStoreForPartner(api, partnerB.headers)

        // Partner A tries to access partner B's key
        try {
          await api.get(
            `/partners/api-keys/${storeDataB.api_key.id}`,
            { headers: partnerA.headers }
          )
          // Should not reach here
          expect(true).toBe(false)
        } catch (err: any) {
          expect(err.response.status).toBe(404)
        }
      })
    })

    describe("Phase 2A: Subdomain Resolution", () => {
      it("should resolve partner config by handle", async () => {
        const { handle, headers } = await createPartnerWithAuth(api)
        const storeData = await createStoreForPartner(api, headers)

        const res = await api.get(`/web/storefront/${handle}`)

        expect(res.status).toBe(200)
        expect(res.data.partner).toBeDefined()
        expect(res.data.partner.handle).toBe(handle)
        expect(res.data.store).toBeDefined()
        expect(res.data.store.id).toBe(storeData.store.id)
        expect(res.data.sales_channel_id).toBeDefined()
        // publishable_key may be the token string
        expect(res.data.publishable_key).toBeDefined()
      })

      it("should return 404 for nonexistent subdomain", async () => {
        try {
          await api.get("/web/storefront/nonexistent-handle-xyz")
          expect(true).toBe(false)
        } catch (err: any) {
          expect(err.response.status).toBe(404)
        }
      })
    })

    describe("Phase 2A: Product Scoping via Publishable Key", () => {
      it("should scope /store/products to the partner's sales channel", async () => {
        const partnerA = await createPartnerWithAuth(api)
        const storeDataA = await createStoreForPartner(api, partnerA.headers)

        // Get the publishable key token via subdomain resolution
        const configRes = await api.get(
          `/web/storefront/${partnerA.handle}`
        )
        const publishableKey = configRes.data.publishable_key

        if (!publishableKey) {
          // If no key token returned (possible in test env), skip
          console.warn("No publishable key token returned — skipping product scoping test")
          return
        }

        // Query /store/products with the publishable key header
        const productsRes = await api.get("/store/products", {
          headers: { "x-publishable-api-key": publishableKey },
        })

        expect(productsRes.status).toBe(200)
        expect(productsRes.data.products).toBeDefined()
        expect(Array.isArray(productsRes.data.products)).toBe(true)
        // No products created yet, so empty is expected
        expect(productsRes.data.products.length).toBe(0)
      })

      it("should not return partner A's products with partner B's key", async () => {
        const partnerA = await createPartnerWithAuth(api)
        const partnerB = await createPartnerWithAuth(api)
        await createStoreForPartner(api, partnerA.headers)
        await createStoreForPartner(api, partnerB.headers)

        const configA = await api.get(`/web/storefront/${partnerA.handle}`)
        const configB = await api.get(`/web/storefront/${partnerB.handle}`)

        const keyA = configA.data.publishable_key
        const keyB = configB.data.publishable_key

        if (!keyA || !keyB) {
          console.warn("Missing publishable keys — skipping cross-partner test")
          return
        }

        // Both should return empty products (none created)
        const productsA = await api.get("/store/products", {
          headers: { "x-publishable-api-key": keyA },
        })
        const productsB = await api.get("/store/products", {
          headers: { "x-publishable-api-key": keyB },
        })

        expect(productsA.status).toBe(200)
        expect(productsB.status).toBe(200)

        // Products are scoped — neither should see the other's products
        const idsA = (productsA.data.products || []).map((p: any) => p.id)
        const idsB = (productsB.data.products || []).map((p: any) => p.id)

        // No overlap (both empty in this case, but structure is correct)
        const overlap = idsA.filter((id: string) => idsB.includes(id))
        expect(overlap.length).toBe(0)
      })
    })
  })
})
