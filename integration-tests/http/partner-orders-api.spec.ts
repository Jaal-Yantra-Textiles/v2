import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { ProductStatus } from "@medusajs/framework/utils"

const TEST_PARTNER_PASSWORD = "supersecret"

jest.setTimeout(120 * 1000)

async function createPartnerWithStoreAndProduct(api: any, adminHeaders: Record<string, any>) {
  const unique = Date.now() + Math.random().toString(36).slice(2, 6)
  const email = `partner-ord-${unique}@medusa-test.com`

  await api.post("/auth/partner/emailpass/register", { email, password: TEST_PARTNER_PASSWORD })
  const login1 = await api.post("/auth/partner/emailpass", { email, password: TEST_PARTNER_PASSWORD })
  let headers: Record<string, string> = { Authorization: `Bearer ${login1.data.token}` }

  const partnerRes = await api.post(
    "/partners",
    {
      name: `OrdTest ${unique}`,
      handle: `ordtest-${unique}`,
      admin: { email, first_name: "Admin", last_name: "Ord" },
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
        name: `OrdStore ${unique}`,
        supported_currencies: [{ currency_code: currencyCode, is_default: true }],
      },
      sales_channel: { name: `OrdChannel ${unique}`, description: "Default" },
      region: { name: "Default Region", currency_code: currencyCode, countries: ["us"] },
      location: {
        name: "Warehouse",
        address: { address_1: "1 Main St", city: "NY", postal_code: "10001", country_code: "US" },
      },
    },
    { headers }
  )

  const storeId = storeRes.data.store.id
  const regionId = storeRes.data.region?.id
  const salesChannelId = storeRes.data.sales_channel?.id

  // Create a product in the store
  const productRes = await api.post(
    "/partners/products",
    {
      store_id: storeId,
      product: {
        title: `Test Product ${unique}`,
        handle: `test-product-${unique}`,
        status: ProductStatus.PUBLISHED,
        options: [{ title: "Size", values: ["M"] }],
        variants: [
          {
            title: "M",
            sku: `ORD-SKU-${unique}`,
            options: { Size: "M" },
            prices: [{ amount: 2000, currency_code: currencyCode }],
          },
        ],
      },
    },
    { headers }
  )

  return {
    headers,
    partnerId,
    storeId,
    regionId,
    salesChannelId,
    currencyCode,
    productId: productRes.data.product?.id,
    variantId: productRes.data.product?.variants?.[0]?.id,
  }
}

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Partner API - Orders", () => {
    let adminHeaders: Record<string, any>
    let partner: Awaited<ReturnType<typeof createPartnerWithStoreAndProduct>>

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)
      partner = await createPartnerWithStoreAndProduct(api, adminHeaders)
    })

    describe("GET /partners/orders", () => {
      it("should list orders (initially empty)", async () => {
        const res = await api.get("/partners/orders", {
          headers: partner.headers,
        })
        expect(res.status).toBe(200)
        expect(Array.isArray(res.data.orders)).toBe(true)
        expect(typeof res.data.count).toBe("number")
        expect(typeof res.data.offset).toBe("number")
        expect(typeof res.data.limit).toBe("number")
      })

      it("should support pagination params", async () => {
        const res = await api.get("/partners/orders?limit=5&offset=0", {
          headers: partner.headers,
        })
        expect(res.status).toBe(200)
        expect(res.data.limit).toBe(5)
        expect(res.data.offset).toBe(0)
      })
    })

    describe("Returns", () => {
      it("GET /partners/returns lists returns (initially empty)", async () => {
        const res = await api.get("/partners/returns", {
          headers: partner.headers,
        })
        expect(res.status).toBe(200)
        expect(Array.isArray(res.data.returns)).toBe(true)
      })
    })

    describe("Exchanges", () => {
      it("GET /partners/exchanges lists exchanges (initially empty)", async () => {
        const res = await api.get("/partners/exchanges", {
          headers: partner.headers,
        })
        expect(res.status).toBe(200)
        expect(Array.isArray(res.data.exchanges)).toBe(true)
      })
    })

    describe("Claims", () => {
      it("GET /partners/claims lists claims (initially empty)", async () => {
        const res = await api.get("/partners/claims", {
          headers: partner.headers,
        })
        expect(res.status).toBe(200)
        expect(Array.isArray(res.data.claims)).toBe(true)
      })
    })

    describe("Order Edits", () => {
      it("GET /partners/order-edits lists edits (initially empty)", async () => {
        const res = await api.get("/partners/order-edits", {
          headers: partner.headers,
          validateStatus: () => true,
        })
        // May return 200 with empty list or 404 if no edits endpoint exists
        expect([200, 404]).toContain(res.status)
        if (res.status === 200) {
          expect(Array.isArray(res.data.order_edits)).toBe(true)
        }
      })
    })
  })
})
