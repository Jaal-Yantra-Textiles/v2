import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"

const TEST_PARTNER_PASSWORD = "supersecret"

jest.setTimeout(90 * 1000)

async function createPartnerWithStore(api: any, adminHeaders: Record<string, any>) {
  const unique = Date.now() + Math.random().toString(36).slice(2, 6)
  const email = `partner-ff-${unique}@medusa-test.com`

  await api.post("/auth/partner/emailpass/register", { email, password: TEST_PARTNER_PASSWORD })
  const login1 = await api.post("/auth/partner/emailpass", { email, password: TEST_PARTNER_PASSWORD })
  let headers: Record<string, string> = { Authorization: `Bearer ${login1.data.token}` }

  const partnerRes = await api.post(
    "/partners",
    {
      name: `FFTest ${unique}`,
      handle: `fftest-${unique}`,
      admin: { email, first_name: "Admin", last_name: "FF" },
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
        name: `FFStore ${unique}`,
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
    locationId: storeRes.data.location.id,
  }
}

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Partner API - Fulfillment & Shipping", () => {
    let adminHeaders: Record<string, any>
    let partner: Awaited<ReturnType<typeof createPartnerWithStore>>

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)
      partner = await createPartnerWithStore(api, adminHeaders)
    })

    describe("GET /partners/fulfillment-providers", () => {
      it("should list enabled fulfillment providers", async () => {
        const res = await api.get("/partners/fulfillment-providers", {
          headers: partner.headers,
        })
        expect(res.status).toBe(200)
        expect(Array.isArray(res.data.fulfillment_providers)).toBe(true)
        // At minimum, manual provider should exist
        expect(res.data.fulfillment_providers.length).toBeGreaterThanOrEqual(1)
      })
    })

    describe("GET /partners/fulfillment-providers/:providerId/options", () => {
      it("should list options for a provider", async () => {
        // First get available providers
        const providersRes = await api.get("/partners/fulfillment-providers", {
          headers: partner.headers,
        })
        const providers = providersRes.data.fulfillment_providers
        expect(providers.length).toBeGreaterThanOrEqual(1)

        const providerId = providers[0].id
        const res = await api.get(
          `/partners/fulfillment-providers/${providerId}/options`,
          { headers: partner.headers }
        )
        expect(res.status).toBe(200)
        expect(Array.isArray(res.data.fulfillment_options)).toBe(true)
      })
    })

    describe("Shipping Profiles", () => {
      it("GET /partners/shipping-profiles lists profiles", async () => {
        const res = await api.get("/partners/shipping-profiles", {
          headers: partner.headers,
        })
        expect(res.status).toBe(200)
        expect(Array.isArray(res.data.shipping_profiles)).toBe(true)
        // Default profile should exist
        expect(res.data.shipping_profiles.length).toBeGreaterThanOrEqual(1)
      })

      it("POST /partners/shipping-profiles creates a profile", async () => {
        const res = await api.post(
          "/partners/shipping-profiles",
          { name: "Fragile Items", type: "custom" },
          { headers: partner.headers }
        )
        expect(res.status).toBe(201)
        expect(res.data.shipping_profile).toBeDefined()
        expect(res.data.shipping_profile.name).toBe("Fragile Items")
      })
    })

    describe("Shipping Option Types", () => {
      it("GET /partners/shipping-option-types lists types", async () => {
        const res = await api.get("/partners/shipping-option-types", {
          headers: partner.headers,
        })
        expect(res.status).toBe(200)
        expect(Array.isArray(res.data.shipping_option_types)).toBe(true)
      })

      it("POST /partners/shipping-option-types creates a type", async () => {
        const unique = Date.now()
        const res = await api.post(
          "/partners/shipping-option-types",
          {
            label: `Express ${unique}`,
            description: "Express delivery type",
            code: `express-${unique}`,
          },
          { headers: partner.headers }
        )
        expect(res.status).toBe(201)
        expect(res.data.shipping_option_type).toBeDefined()
        expect(res.data.shipping_option_type.label).toBe(`Express ${unique}`)
      })
    })

    describe("Location Fulfillment Providers", () => {
      it("POST /partners/stores/:id/locations/:locId/fulfillment-providers adds a provider", async () => {
        // Get available providers
        const providersRes = await api.get("/partners/fulfillment-providers", {
          headers: partner.headers,
        })
        const providers = providersRes.data.fulfillment_providers
        if (providers.length === 0) return // skip if no providers

        const providerId = providers[0].id

        const res = await api.post(
          `/partners/stores/${partner.storeId}/locations/${partner.locationId}/fulfillment-providers`,
          { add: [providerId] },
          { headers: partner.headers }
        )
        expect(res.status).toBe(200)
        expect(res.data.stock_location).toBeDefined()
      })
    })

    describe("Location Fulfillment Sets", () => {
      it("POST /partners/stores/:id/locations/:locId/fulfillment-sets creates a set", async () => {
        const unique = Date.now()
        const res = await api.post(
          `/partners/stores/${partner.storeId}/locations/${partner.locationId}/fulfillment-sets`,
          {
            name: `Custom Shipping ${unique}`,
            type: "shipping",
          },
          { headers: partner.headers }
        )
        expect(res.status).toBe(201)
        expect(res.data.fulfillment_set).toBeDefined()
        expect(res.data.fulfillment_set.type).toBe("shipping")
      })
    })
  })
})
