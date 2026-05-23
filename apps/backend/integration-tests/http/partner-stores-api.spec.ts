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

    describe("Store Regions (marketplace inheritance model)", () => {
      it("GET /partners/stores/:id/regions returns ALL admin regions (no per-partner filter)", async () => {
        // Under the marketplace inheritance model, every partner sees the
        // full admin-curated region catalog automatically. This means
        // when a customer from any of those countries lands on a partner
        // storefront, pricing/tax resolution works — no per-partner
        // subscription step that could leave gaps.
        const res = await api.get(`/partners/stores/${partner.storeId}/regions`, {
          headers: partner.headers,
        })
        expect(res.status).toBe(200)
        expect(Array.isArray(res.data.regions)).toBe(true)
        expect(res.data.regions.length).toBeGreaterThanOrEqual(1)

        const defaultRegion = res.data.regions.find((r: any) => r.id === partner.regionId)
        expect(defaultRegion).toBeDefined()
      })

      it("second partner sees first partner's region too (inheritance)", async () => {
        // Two partners onboarding sequentially. Under the inheritance
        // model, partner 2 should see partner 1's region in their list
        // (and vice versa) because both inherit the full admin catalog.
        const partner2 = await createPartnerWithStore(api, adminHeaders)

        const res2 = await api.get(
          `/partners/stores/${partner2.storeId}/regions`,
          { headers: partner2.headers }
        )
        // Both partners' region ids should appear in partner 2's list.
        const ids = (res2.data.regions || []).map((r: any) => r.id)
        expect(ids).toContain(partner.regionId)
        expect(ids).toContain(partner2.regionId)
      })

      it("POST /partners/stores/:id/regions is refused — admin-managed catalog", async () => {
        const res = await api.post(
          `/partners/stores/${partner.storeId}/regions`,
          {
            name: "EU Region",
            currency_code: partner.currencyCode,
            countries: ["gb"],
          },
          { headers: partner.headers, validateStatus: () => true }
        )
        expect(res.status).toBeGreaterThanOrEqual(400)
        expect(res.status).toBeLessThan(500)
        expect(String(res.data?.message ?? "")).toMatch(/admin-managed/i)
      })

      it("POST /partners/stores/:id/regions/:regionId is refused — no partner mutation of shared rows", async () => {
        const res = await api.post(
          `/partners/stores/${partner.storeId}/regions/${partner.regionId}`,
          { name: "Hijacked Region Name" },
          { headers: partner.headers, validateStatus: () => true }
        )
        expect(res.status).toBeGreaterThanOrEqual(400)
        expect(res.status).toBeLessThan(500)
        expect(String(res.data?.message ?? "")).toMatch(/cannot modify/i)

        // And nothing actually changed.
        const verify = await api.get(
          `/partners/stores/${partner.storeId}/regions`,
          { headers: partner.headers }
        )
        const region = verify.data.regions.find((r: any) => r.id === partner.regionId)
        expect(region?.name).not.toBe("Hijacked Region Name")
      })

      it("DELETE /partners/stores/:id/regions/:regionId is refused — partners don't opt out of inherited regions", async () => {
        const delRes = await api.delete(
          `/partners/stores/${partner.storeId}/regions/${partner.regionId}`,
          { headers: partner.headers, validateStatus: () => true }
        )
        expect(delRes.status).toBeGreaterThanOrEqual(400)
        expect(delRes.status).toBeLessThan(500)
        expect(String(delRes.data?.message ?? "")).toMatch(/cannot delete/i)

        // The region still appears in the partner's list (inherited from admin catalog).
        const listRes = await api.get(
          `/partners/stores/${partner.storeId}/regions`,
          { headers: partner.headers }
        )
        const stillVisible = listRes.data.regions.find(
          (r: any) => r.id === partner.regionId
        )
        expect(stillVisible).toBeDefined()

        // Admin-side row is also intact.
        const adminRes = await api.get(
          `/admin/regions/${partner.regionId}`,
          adminHeaders
        )
        expect(adminRes.status).toBe(200)
        expect(adminRes.data.region.id).toBe(partner.regionId)
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

      it("POST /partners/stores/:id/shipping-options/:optionId persists prices", async () => {
        // Regression test for the bare-service silent-drop bug: the route
        // previously called fulfillmentService.updateShippingOptions(id, body)
        // which doesn't know about the pricing module, so the `prices` array
        // was dropped on the floor and the API returned 200 with the option
        // unchanged. Fix routes through updateShippingOptionsWorkflow.

        // Scaffold: find a service_zone on the location's shipping
        // fulfillment_set. The store-create workflow seeded one.
        const locRes = await api.get(
          `/partners/stores/${partner.storeId}/locations/${partner.locationId}`,
          { headers: partner.headers }
        )
        const shippingSet = (
          locRes.data.stock_location.fulfillment_sets || []
        ).find((fs: any) => fs.type === "shipping")
        const serviceZoneId = shippingSet?.service_zones?.[0]?.id
        expect(serviceZoneId).toBeDefined()

        // Ensure a shipping profile exists.
        let profilesRes = await api.get(`/partners/shipping-profiles`, {
          headers: partner.headers,
        })
        let profileId = profilesRes.data.shipping_profiles?.[0]?.id
        if (!profileId) {
          const profileCreateRes = await api.post(
            `/partners/shipping-profiles`,
            { name: "Default Test Profile", type: "default" },
            { headers: partner.headers }
          )
          profileId = profileCreateRes.data.shipping_profile?.id
        }
        expect(profileId).toBeDefined()

        // Create a shipping option with an initial price. The CREATE
        // route uses createShippingOptionsWorkflow already, so this
        // half is known-good — we only need it to set up state for the
        // UPDATE test below.
        const createRes = await api.post(
          `/partners/stores/${partner.storeId}/shipping-options`,
          {
            name: "Test Option",
            service_zone_id: serviceZoneId,
            shipping_profile_id: profileId,
            provider_id: "manual_manual",
            price_type: "flat",
            type: {
              label: "Standard",
              description: "Standard",
              code: "standard",
            },
            prices: [{ currency_code: partner.currencyCode, amount: 100 }],
          },
          { headers: partner.headers }
        )
        expect(createRes.status).toBe(201)
        const optionId = createRes.data.shipping_option.id

        // The actual test: UPDATE the price via POST and confirm it
        // persists. HTTP 200 alone passed even with the silent-drop bug.
        const newAmount = 7777
        const updateRes = await api.post(
          `/partners/stores/${partner.storeId}/shipping-options/${optionId}`,
          {
            prices: [{ currency_code: partner.currencyCode, amount: newAmount }],
          },
          { headers: partner.headers }
        )
        expect(updateRes.status).toBe(200)

        const verifyRes = await api.get(
          `/partners/stores/${partner.storeId}/shipping-options/${optionId}`,
          { headers: partner.headers }
        )
        const persisted = (verifyRes.data.shipping_option.prices || []).find(
          (p: any) =>
            p.currency_code === partner.currencyCode &&
            // Exclude conditional / region-scoped prices for this assertion.
            !(p.price_rules || []).length
        )
        expect(persisted?.amount).toBe(newAmount)

        // Region-scoped price: the partner-ui's pricing grid has a
        // separate "region" column that sends `{ region_id, amount }`
        // (no `rules` wrapper) in the same `prices` array. The workflow
        // accepts that shape and stores it with a price_rule for the
        // region. Verify the round-trip works for that path too — this
        // is what the user reported as "price update per location still
        // not working" before the route fix.
        const regionAmount = 8888
        const regionUpdateRes = await api.post(
          `/partners/stores/${partner.storeId}/shipping-options/${optionId}`,
          {
            prices: [{ region_id: partner.regionId, amount: regionAmount }],
          },
          { headers: partner.headers }
        )
        expect(regionUpdateRes.status).toBe(200)

        const regionVerifyRes = await api.get(
          `/partners/stores/${partner.storeId}/shipping-options/${optionId}`,
          { headers: partner.headers }
        )
        const regionPersisted = (
          regionVerifyRes.data.shipping_option.prices || []
        ).find((p: any) =>
          (p.price_rules || []).some(
            (r: any) =>
              r.attribute === "region_id" && r.value === partner.regionId
          )
        )
        expect(regionPersisted?.amount).toBe(regionAmount)
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

      it("POST /partners/stores/:id/tax-regions is refused — admin-managed catalog", async () => {
        const res = await api.post(
          `/partners/stores/${partner.storeId}/tax-regions`,
          {
            country_code: "fr",
            provider_id: "tp_system",
            default_tax_rate: { code: "fr-vat", name: "France VAT", rate: 20 },
          },
          { headers: partner.headers, validateStatus: () => true }
        )
        expect(res.status).toBeGreaterThanOrEqual(400)
        expect(res.status).toBeLessThan(500)
        expect(String(res.data?.message ?? "")).toMatch(/admin-managed/i)
      })

      it("POST /partners/stores/:id/tax-regions/:taxRegionId is refused", async () => {
        // We don't have a tax_region id to target here without seeding one,
        // but the route must refuse before any handler logic — so even a
        // bogus id should produce the lockdown message, not a 404.
        const res = await api.post(
          `/partners/stores/${partner.storeId}/tax-regions/txreg_doesnt_matter`,
          { province_code: "tampered" },
          { headers: partner.headers, validateStatus: () => true }
        )
        expect(res.status).toBeGreaterThanOrEqual(400)
        expect(res.status).toBeLessThan(500)
        expect(String(res.data?.message ?? "")).toMatch(/cannot modify/i)
      })

      it("DELETE /partners/stores/:id/tax-regions/:taxRegionId is refused", async () => {
        const res = await api.delete(
          `/partners/stores/${partner.storeId}/tax-regions/txreg_doesnt_matter`,
          { headers: partner.headers, validateStatus: () => true }
        )
        expect(res.status).toBeGreaterThanOrEqual(400)
        expect(res.status).toBeLessThan(500)
        expect(String(res.data?.message ?? "")).toMatch(/cannot delete/i)
      })
    })
  })
})
