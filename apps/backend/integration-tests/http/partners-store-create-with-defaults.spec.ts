import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"

const TEST_PARTNER_PASSWORD = "supersecret"

jest.setTimeout(60 * 1000)

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Partner API - Create Store With Defaults", () => {
    let adminHeaders: Record<string, any>
    let partnerHeaders: Record<string, string>
    let partnerId: string
    let partnerEmail: string

    beforeEach(async () => {
      // Admin auth (for calling /admin/* like /admin/currencies)
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)

      // Partner setup (mirror pattern from partners-api.spec.ts)
      const unique = Date.now()
      partnerEmail = `partner-${unique}@medusa-test.com`

      // 1) Register partner admin
      await api.post("/auth/partner/emailpass/register", {
        email: partnerEmail,
        password: TEST_PARTNER_PASSWORD,
      })

      // 2) Login to get initial token
      const login1 = await api.post("/auth/partner/emailpass", {
        email: partnerEmail,
        password: TEST_PARTNER_PASSWORD,
      })
      partnerHeaders = { Authorization: `Bearer ${login1.data.token}` }

      // 3) Create partner entity
      const createRes = await api.post(
        "/partners",
        {
          name: `Acme ${unique}`,
          handle: `acme-${unique}`,
          admin: {
            email: partnerEmail,
            first_name: "Admin",
            last_name: "Acme",
          },
        },
        { headers: partnerHeaders }
      )
      partnerId = createRes.data.partner.id

      // 4) IMPORTANT: Fresh token after partner creation
      const login2 = await api.post("/auth/partner/emailpass", {
        email: partnerEmail,
        password: TEST_PARTNER_PASSWORD,
      })
      partnerHeaders = { Authorization: `Bearer ${login2.data.token}` }
    })

    it("fetches admin currencies, then creates a store with defaults using the selected currency", async () => {
      // 1) Fetch currencies from admin API so the test uses system-defined values
      const currenciesRes = await api.get("/admin/currencies", adminHeaders)
      expect(currenciesRes.status).toBe(200)
      const currencies = currenciesRes.data.currencies || []
      expect(Array.isArray(currencies)).toBe(true)
      expect(currencies.length).toBeGreaterThan(0)

      // Prefer USD if available, else pick the first
      const usd = currencies.find((c: any) => c.code?.toLowerCase() === "usd")
      const selected = usd || currencies[0]
      const currencyCode = String(selected.code).toLowerCase()

      // Choose a reasonable country list for the region
      const countries: string[] = currencyCode === "usd" ? ["us"] : ["us"]

      // 2) Call the new Partner Store creation endpoint with selected currency
      const unique = Date.now()
      const payload = {
        store: {
          name: `Acme Store ${unique}`,
          supported_currencies: [{ currency_code: currencyCode, is_default: true }],
          metadata: { test_run: unique },
        },
        sales_channel: {
          name: `Acme ${unique} - Default`,
          description: "Default sales channel",
        },
        region: {
          name: "Default Region",
          currency_code: currencyCode,
          countries,
        },
        location: {
          name: "Main Warehouse",
          address: {
            address_1: "123 Main St",
            city: "New York",
            postal_code: "10001",
            country_code: "US",
          },
        },
      }

      const createStoreRes = await api.post(
        "/partners/stores",
        payload,
        { headers: partnerHeaders }
      )
      console.log(createStoreRes.data)
      expect(createStoreRes.status).toBe(201)
      const body = createStoreRes.data
      expect(body.partner_id).toBeDefined()
      expect(body.store).toBeDefined()
      expect(body.sales_channel).toBeDefined()
      expect(body.region).toBeDefined()
      expect(body.location).toBeDefined()

      // Basic assertions on returned data integrity
      expect(body.store.name).toContain("Acme Store")
      expect(body.store.metadata?.partner_id).toBeDefined()
      expect([currencyCode]).toContain(body.region.currency_code)
      expect(body.location.address?.country_code).toBe("US")

      // Verify fulfillment sets were created for the location
      const locationId = body.location.id
      const fulfillmentRes = await api.get(
        `/admin/stock-locations/${locationId}?fields=*fulfillment_sets`,
        adminHeaders
      )
      const fulfillmentSets = fulfillmentRes.data.stock_location?.fulfillment_sets || []
      const types = fulfillmentSets.map((fs: any) => fs.type)
      expect(types).toContain("shipping")
      expect(types).toContain("pickup")
    })

    it("provisions onto the type:'default' profile even when a second profile exists (#1983)", async () => {
      // 🔴 The regression this pins. Provisioning read
      // `listShippingProfiles({}, { take: 1 })` and fed the answer to all ten
      // of a new store's shipping options — correct by ACCIDENT while exactly
      // one profile exists, which is the state prod is in. Add a second and
      // the choice becomes whichever row Postgres returned, per store,
      // silently; the store provisions fine and the mismatch surfaces later as
      // "The shipping option you have selected don't allow fulfillment of this
      // item" on a real order.
      //
      // This has to be an integration test: the defect is in what the DATABASE
      // hands back, and a unit test with a stubbed service would assert against
      // an order this code never sees.
      // Build the two-profile world explicitly rather than lean on the seed:
      // this runner starts with NO shipping profiles at all (checked — the
      // list comes back empty), so a test that assumed a seeded default would
      // have been asserting about a database that does not exist.
      //
      // 🔑 The CUSTOM profile is created FIRST, and that ordering is the whole
      // test. Created default-first, `take: 1` returns the default and the old
      // broken code passes this test — I checked, and it did: 3/3 green on the
      // defect. A regression test that cannot fail on the bug is not a test of
      // the bug. Custom-first makes `take: 1` return the wrong row, which is
      // precisely the nondeterminism the fix removes.
      const unique = Date.now()
      const partnerRes = await api.post(
        "/admin/shipping-profiles",
        { name: `Partner Shipping Profile ${unique}`, type: "custom" },
        adminHeaders
      )
      const defaultRes = await api.post(
        "/admin/shipping-profiles",
        { name: `Default Shipping Profile ${unique}`, type: "default" },
        adminHeaders
      )
      const defaultProfileId = defaultRes.data.shipping_profile.id
      const partnerProfileId = partnerRes.data.shipping_profile.id
      expect(defaultProfileId).not.toBe(partnerProfileId)

      // The premise, asserted rather than assumed: exactly two profiles, one
      // of them default. If either ever stops being true the assertion at the
      // end would be answering a different question than the one it claims to.
      const profilesRes = await api.get("/admin/shipping-profiles", adminHeaders)
      const profiles = profilesRes.data.shipping_profiles || []
      expect(profiles).toHaveLength(2)
      expect(profiles.filter((p: any) => p.type === "default")).toHaveLength(1)

      const createStoreRes = await api.post(
        "/partners/stores",
        {
          store: {
            name: `Profile Store ${unique}`,
            supported_currencies: [{ currency_code: "usd", is_default: true }],
          },
          sales_channel: { name: `Profile ${unique} - Default` },
          region: { name: "Default Region", currency_code: "usd", countries: ["us"] },
          location: {
            name: "Main Warehouse",
            address: {
              address_1: "123 Main St",
              city: "New York",
              postal_code: "10001",
              country_code: "US",
            },
          },
        },
        { headers: partnerHeaders }
      )
      expect(createStoreRes.status).toBe(201)

      // Read the options back rather than trusting the create response: the
      // profile id is written per option, and it is the stored value that
      // decides whether a product can be fulfilled.
      const locationId = createStoreRes.data.location.id
      const zonesRes = await api.get(
        `/admin/stock-locations/${locationId}?fields=*fulfillment_sets,fulfillment_sets.service_zones.id`,
        adminHeaders
      )
      const zoneIds = (
        zonesRes.data.stock_location?.fulfillment_sets || []
      ).flatMap((fs: any) => (fs.service_zones || []).map((z: any) => z.id))
      expect(zoneIds.length).toBeGreaterThan(0)

      const profileIds = new Set<string>()
      for (const zoneId of zoneIds) {
        const optionsRes = await api.get(
          `/admin/shipping-options?service_zone_id=${zoneId}`,
          adminHeaders
        )
        for (const option of optionsRes.data.shipping_options || []) {
          profileIds.add(option.shipping_profile_id)
        }
      }

      // A vacuous pass is not a pass: if the store came out with no options at
      // all (the #1176 failure) the set would be empty and every assertion
      // below would hold for the wrong reason.
      expect(profileIds.size).toBeGreaterThan(0)
      expect([...profileIds]).toEqual([defaultProfileId])
    })

    it("creates a second store without fulfillment set name collisions", async () => {
      // Create FIRST store
      const unique1 = Date.now()
      await api.post(
        "/partners/stores",
        {
          store: {
            name: `Store A ${unique1}`,
            supported_currencies: [{ currency_code: "usd", is_default: true }],
          },
          region: { name: "Default Region", currency_code: "usd", countries: ["us"] },
          location: {
            name: "Warehouse A",
            address: { address_1: "123 Main St", city: "New York", postal_code: "10001", country_code: "US" },
          },
        },
        { headers: partnerHeaders }
      )

      // Create a SECOND partner
      const unique2 = Date.now() + 1
      const email2 = `partner2-${unique2}@medusa-test.com`
      await api.post("/auth/partner/emailpass/register", {
        email: email2,
        password: TEST_PARTNER_PASSWORD,
      })
      const login2 = await api.post("/auth/partner/emailpass", {
        email: email2,
        password: TEST_PARTNER_PASSWORD,
      })
      let headers2 = { Authorization: `Bearer ${login2.data.token}` }

      await api.post(
        "/partners",
        {
          name: `Partner B ${unique2}`,
          handle: `partner-b-${unique2}`,
          admin: { email: email2, first_name: "B", last_name: "Partner" },
        },
        { headers: headers2 }
      )

      const login2b = await api.post("/auth/partner/emailpass", {
        email: email2,
        password: TEST_PARTNER_PASSWORD,
      })
      headers2 = { Authorization: `Bearer ${login2b.data.token}` }

      // Create SECOND store — same country, should not collide on fulfillment set names
      const res2 = await api.post(
        "/partners/stores",
        {
          store: {
            name: `Store B ${unique2}`,
            supported_currencies: [{ currency_code: "usd", is_default: true }],
          },
          region: { name: "Default Region", currency_code: "usd", countries: ["us"] },
          location: {
            name: "Warehouse B",
            address: { address_1: "456 Oak Ave", city: "Boston", postal_code: "02101", country_code: "US" },
          },
        },
        { headers: headers2 }
      )

      expect(res2.status).toBe(201)
      expect(res2.data.store).toBeDefined()
      expect(res2.data.location).toBeDefined()

      // Verify second location also has fulfillment sets
      const loc2Id = res2.data.location.id
      const fs2Res = await api.get(
        `/admin/stock-locations/${loc2Id}?fields=*fulfillment_sets`,
        adminHeaders
      )
      const fs2 = fs2Res.data.stock_location?.fulfillment_sets || []
      const types2 = fs2.map((fs: any) => fs.type)
      expect(types2).toContain("shipping")
      expect(types2).toContain("pickup")
    })
  })
})
