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
    })
  })
})
