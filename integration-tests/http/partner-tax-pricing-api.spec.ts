import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"

const TEST_PARTNER_PASSWORD = "supersecret"

jest.setTimeout(90 * 1000)

async function createPartnerWithStore(api: any, adminHeaders: Record<string, any>) {
  const unique = Date.now() + Math.random().toString(36).slice(2, 6)
  const email = `partner-tax-${unique}@medusa-test.com`

  await api.post("/auth/partner/emailpass/register", { email, password: TEST_PARTNER_PASSWORD })
  const login1 = await api.post("/auth/partner/emailpass", { email, password: TEST_PARTNER_PASSWORD })
  let headers: Record<string, string> = { Authorization: `Bearer ${login1.data.token}` }

  const partnerRes = await api.post(
    "/partners",
    {
      name: `TaxTest ${unique}`,
      handle: `taxtest-${unique}`,
      admin: { email, first_name: "Admin", last_name: "Tax" },
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
        name: `TaxStore ${unique}`,
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
    regionId: storeRes.data.region?.id,
    currencyCode,
  }
}

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Partner API - Tax, Pricing & Currencies", () => {
    let adminHeaders: Record<string, any>
    let partner: Awaited<ReturnType<typeof createPartnerWithStore>>

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)
      partner = await createPartnerWithStore(api, adminHeaders)
    })

    describe("Tax Providers", () => {
      it("GET /partners/tax-providers lists providers", async () => {
        const res = await api.get("/partners/tax-providers", {
          headers: partner.headers,
        })
        expect(res.status).toBe(200)
        expect(Array.isArray(res.data.tax_providers)).toBe(true)
      })
    })

    describe("Tax Rates", () => {
      it("GET /partners/tax-rates lists rates (initially may be empty)", async () => {
        const res = await api.get("/partners/tax-rates", {
          headers: partner.headers,
        })
        expect(res.status).toBe(200)
        expect(Array.isArray(res.data.tax_rates)).toBe(true)
      })

      it("creates a tax region, then creates a tax rate for it", async () => {
        // First create a tax region
        const taxRegionRes = await api.post(
          `/partners/stores/${partner.storeId}/tax-regions`,
          {
            country_code: "us",
          },
          { headers: partner.headers }
        )
        expect(taxRegionRes.status).toBe(201)
        const taxRegionId = taxRegionRes.data.tax_region.id

        // Create a tax rate
        const rateRes = await api.post(
          "/partners/tax-rates",
          {
            tax_region_id: taxRegionId,
            name: "Sales Tax",
            rate: 8.5,
            code: "sales-tax",
          },
          { headers: partner.headers }
        )
        expect(rateRes.status).toBe(201)
        expect(rateRes.data.tax_rate).toBeDefined()
        expect(rateRes.data.tax_rate.name).toBe("Sales Tax")
        expect(rateRes.data.tax_rate.rate).toBe(8.5)

        // Verify it shows when listing by tax_region_id
        const listRes = await api.get(
          `/partners/tax-rates?tax_region_id=${taxRegionId}`,
          { headers: partner.headers }
        )
        expect(listRes.data.tax_rates.length).toBeGreaterThanOrEqual(1)
        const found = listRes.data.tax_rates.some(
          (r: any) => r.id === rateRes.data.tax_rate.id
        )
        expect(found).toBe(true)
      })
    })

    describe("Price Preferences", () => {
      it("GET /partners/price-preferences lists preferences", async () => {
        const res = await api.get("/partners/price-preferences", {
          headers: partner.headers,
        })
        expect(res.status).toBe(200)
        expect(Array.isArray(res.data.price_preferences)).toBe(true)
      })

      it("POST /partners/price-preferences creates a preference", async () => {
        const res = await api.post(
          "/partners/price-preferences",
          {
            attribute: "currency_code",
            value: partner.currencyCode,
            is_tax_inclusive: true,
          },
          { headers: partner.headers }
        )
        expect(res.status).toBe(201)
        expect(res.data.price_preference).toBeDefined()
        expect(res.data.price_preference.is_tax_inclusive).toBe(true)
      })
    })

    describe("Currencies", () => {
      it("GET /partners/currencies lists currencies", async () => {
        const res = await api.get("/partners/currencies", {
          headers: partner.headers,
        })
        expect(res.status).toBe(200)
        expect(res.data.partner_id).toBe(partner.partnerId)
        expect(Array.isArray(res.data.currencies)).toBe(true)
        expect(res.data.currencies.length).toBeGreaterThan(0)
        expect(typeof res.data.count).toBe("number")
      })
    })

    describe("Payment Providers", () => {
      it("GET /partners/payment-providers lists providers", async () => {
        const res = await api.get("/partners/payment-providers", {
          headers: partner.headers,
        })
        expect(res.status).toBe(200)
        expect(Array.isArray(res.data.payment_providers)).toBe(true)
      })
    })
  })
})
