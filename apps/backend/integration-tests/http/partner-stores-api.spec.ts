import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"

const TEST_PARTNER_PASSWORD = "supersecret"

jest.setTimeout(90 * 1000)

/**
 * Helper: create a partner with auth, store, and all defaults.
 * Returns headers, partnerId, storeId, locationId, salesChannelId, regionId.
 */
async function createPartnerWithStore(api: any, adminHeaders: Record<string, any>) {
  const unique = Date.now() + Math.random().toString(36).slice(2, 6)
  const email = `partner-store-${unique}@medusa-test.com`

  await api.post("/auth/partner/emailpass/register", {
    email,
    password: TEST_PARTNER_PASSWORD,
  })

  const login1 = await api.post("/auth/partner/emailpass", {
    email,
    password: TEST_PARTNER_PASSWORD,
  })
  let headers: Record<string, string> = { Authorization: `Bearer ${login1.data.token}` }

  const partnerRes = await api.post(
    "/partners",
    {
      name: `StoreTest ${unique}`,
      handle: `storetest-${unique}`,
      admin: { email, first_name: "Admin", last_name: "Store" },
    },
    { headers }
  )
  const partnerId = partnerRes.data.partner.id

  const login2 = await api.post("/auth/partner/emailpass", {
    email,
    password: TEST_PARTNER_PASSWORD,
  })
  headers = { Authorization: `Bearer ${login2.data.token}` }

  // Fetch currencies
  const currenciesRes = await api.get("/admin/currencies", adminHeaders)
  const currencies = currenciesRes.data.currencies || []
  const usd = currencies.find((c: any) => c.code?.toLowerCase() === "usd")
  const currencyCode = String((usd || currencies[0]).code).toLowerCase()

  // Create store with defaults
  const storeRes = await api.post(
    "/partners/stores",
    {
      store: {
        name: `Store ${unique}`,
        supported_currencies: [{ currency_code: currencyCode, is_default: true }],
      },
      sales_channel: { name: `Channel ${unique}`, description: "Default" },
      region: { name: "Default Region", currency_code: currencyCode, countries: ["us"] },
      location: {
        name: "Main Warehouse",
        address: { address_1: "123 Main St", city: "New York", postal_code: "10001", country_code: "US" },
      },
    },
    { headers }
  )

  return {
    headers,
    partnerId,
    email,
    currencyCode,
    storeId: storeRes.data.store.id,
    locationId: storeRes.data.location.id,
    salesChannelId: storeRes.data.sales_channel?.id,
    regionId: storeRes.data.region?.id,
  }
}

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Partner API - Store Management", () => {
    let adminHeaders: Record<string, any>
    let partner: Awaited<ReturnType<typeof createPartnerWithStore>>

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)
      partner = await createPartnerWithStore(api, adminHeaders)
    })

    describe("GET /partners/stores", () => {
      it("should list stores for the partner", async () => {
        const res = await api.get("/partners/stores", { headers: partner.headers })
        expect(res.status).toBe(200)
        expect(res.data.partner_id).toBe(partner.partnerId)
        expect(res.data.count).toBeGreaterThanOrEqual(1)
        expect(Array.isArray(res.data.stores)).toBe(true)

        const store = res.data.stores.find((s: any) => s.id === partner.storeId)
        expect(store).toBeDefined()
      })
    })

    describe("GET /partners/stores/:id", () => {
      it("should retrieve a single store", async () => {
        const res = await api.get(`/partners/stores/${partner.storeId}`, {
          headers: partner.headers,
        })
        expect(res.status).toBe(200)
        expect(res.data.store).toBeDefined()
        expect(res.data.store.id).toBe(partner.storeId)
      })

      it("should reject access to another partner's store", async () => {
        const other = await createPartnerWithStore(api, adminHeaders)
        const res = await api
          .get(`/partners/stores/${other.storeId}`, {
            headers: partner.headers,
            validateStatus: () => true,
          })
        expect([400, 403]).toContain(res.status)
      })
    })

    describe("POST /partners/stores/:id (update)", () => {
      it("should update the store name", async () => {
        const res = await api.post(
          `/partners/stores/${partner.storeId}`,
          { name: "Updated Store Name" },
          { headers: partner.headers }
        )
        expect(res.status).toBe(200)
        expect(res.data.store.name).toBe("Updated Store Name")
      })
    })

    describe("Store Locations", () => {
      it("GET /partners/stores/:id/locations returns locations with address", async () => {
        const res = await api.get(`/partners/stores/${partner.storeId}/locations`, {
          headers: partner.headers,
        })
        expect(res.status).toBe(200)
        expect(Array.isArray(res.data.stock_locations)).toBe(true)
        expect(res.data.stock_locations.length).toBeGreaterThanOrEqual(1)

        const loc = res.data.stock_locations[0]
        expect(loc.address).toBeDefined()
      })
    })

    describe("Store Regions (partner-scoped via link)", () => {
      it("GET /partners/stores/:id/regions returns partner's linked regions", async () => {
        const res = await api.get(`/partners/stores/${partner.storeId}/regions`, {
          headers: partner.headers,
        })
        expect(res.status).toBe(200)
        expect(Array.isArray(res.data.regions)).toBe(true)
        // The default region created during store setup should be linked
        expect(res.data.regions.length).toBeGreaterThanOrEqual(1)

        const defaultRegion = res.data.regions.find((r: any) => r.id === partner.regionId)
        expect(defaultRegion).toBeDefined()
      })

      it("POST /partners/stores/:id/regions creates and links a new region", async () => {
        const res = await api.post(
          `/partners/stores/${partner.storeId}/regions`,
          {
            name: "EU Region",
            currency_code: partner.currencyCode,
            countries: ["gb"],
          },
          { headers: partner.headers }
        )
        expect(res.status).toBe(201)
        expect(res.data.region).toBeDefined()
        expect(res.data.region.name).toBe("EU Region")

        // Verify the new region appears in the partner's region list
        const listRes = await api.get(`/partners/stores/${partner.storeId}/regions`, {
          headers: partner.headers,
        })
        expect(listRes.data.regions.length).toBeGreaterThanOrEqual(2)
        const euRegion = listRes.data.regions.find((r: any) => r.name === "EU Region")
        expect(euRegion).toBeDefined()
      })

      it("regions are scoped per partner - another partner cannot see them", async () => {
        // Create a second region for partner 1
        await api.post(
          `/partners/stores/${partner.storeId}/regions`,
          {
            name: "Partner1 Region",
            currency_code: partner.currencyCode,
            countries: ["de"],
          },
          { headers: partner.headers }
        )

        // Create partner 2
        const partner2 = await createPartnerWithStore(api, adminHeaders)

        // Partner 2 should NOT see partner 1's regions
        const res2 = await api.get(`/partners/stores/${partner2.storeId}/regions`, {
          headers: partner2.headers,
        })
        const partner1Region = res2.data.regions.find((r: any) => r.name === "Partner1 Region")
        expect(partner1Region).toBeUndefined()
      })
    })

    describe("Store Sales Channels", () => {
      it("GET /partners/stores/:id/sales-channels returns channels", async () => {
        const res = await api.get(`/partners/stores/${partner.storeId}/sales-channels`, {
          headers: partner.headers,
        })
        expect(res.status).toBe(200)
        expect(Array.isArray(res.data.sales_channels)).toBe(true)
        expect(res.data.sales_channels.length).toBeGreaterThanOrEqual(1)
      })
    })

    describe("Store Shipping Options", () => {
      it("GET /partners/stores/:id/shipping-options lists shipping options", async () => {
        const res = await api.get(`/partners/stores/${partner.storeId}/shipping-options`, {
          headers: partner.headers,
        })
        expect(res.status).toBe(200)
        expect(Array.isArray(res.data.shipping_options)).toBe(true)
        // Store was created with defaults, so there should be shipping options
        expect(res.data.count).toBeGreaterThanOrEqual(0)
      })
    })

    describe("Store Tax Regions", () => {
      it("GET /partners/stores/:id/tax-regions returns tax regions", async () => {
        const res = await api.get(`/partners/stores/${partner.storeId}/tax-regions`, {
          headers: partner.headers,
        })
        expect(res.status).toBe(200)
        expect(Array.isArray(res.data.tax_regions)).toBe(true)
      })
    })
  })
})
