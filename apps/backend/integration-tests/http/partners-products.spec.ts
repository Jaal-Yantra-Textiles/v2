import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { ProductStatus } from "@medusajs/framework/utils"

const TEST_PARTNER_PASSWORD = "supersecret"

jest.setTimeout(60 * 1000)

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Partner API - Create & List Products for Store", () => {
    let adminHeaders: Record<string, any>
    let partnerHeaders: Record<string, string>
    let partnerId: string
    let storeId: string

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)

      const unique = Date.now()
      const partnerEmail = `partner-${unique}@medusa-test.com`

      // Register partner admin
      await api.post("/auth/partner/emailpass/register", {
        email: partnerEmail,
        password: TEST_PARTNER_PASSWORD,
      })

      // Login to get initial token
      const login1 = await api.post("/auth/partner/emailpass", {
        email: partnerEmail,
        password: TEST_PARTNER_PASSWORD,
      })
      partnerHeaders = { Authorization: `Bearer ${login1.data.token}` }

      // Create partner entity
      const partnerRes = await api.post(
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
      partnerId = partnerRes.data.partner.id

      // Fresh token after partner creation
      const login2 = await api.post("/auth/partner/emailpass", {
        email: partnerEmail,
        password: TEST_PARTNER_PASSWORD,
      })
      partnerHeaders = { Authorization: `Bearer ${login2.data.token}` }

      // Fetch currencies from admin API
      const currenciesRes = await api.get("/admin/currencies", adminHeaders)
      const currencies = currenciesRes.data.currencies || []
      const usd = currencies.find((c: any) => c.code?.toLowerCase() === "usd")
      const selected = usd || currencies[0]
      const currencyCode = String(selected.code).toLowerCase()

      // Create a store for this partner
      const storePayload = {
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
          countries: ["us"],
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
      const storeRes = await api.post("/partners/stores", storePayload, {
        headers: partnerHeaders,
      })
      expect(storeRes.status).toBe(201)
      storeId = storeRes.data.store.id
    })

    it("creates a product associated to the store's default sales channel and lists it", async () => {
      // Create product
      const productPayload = {
        store_id: storeId,
        product: {
          title: "Test Product",
          handle: `test-product-${Date.now()}`,
          status: ProductStatus.PUBLISHED,
          options: [
            {
              title: "Size",
              values: ["S"],
            },
          ],
          variants: [
            {
              title: "S",
              sku: `TEST-SKU-${Date.now()}`,
              options: { Size: "S" },
              prices: [
                {
                  amount: 1000,
                  currency_code: "usd",
                },
              ],
            },
          ],
        },
      }

      const createProdRes = await api.post(
        "/partners/products",
        productPayload,
        { headers: partnerHeaders }
      )
      expect(createProdRes.status).toBe(201)
      expect(createProdRes.data.partner_id).toBe(partnerId)
      expect(createProdRes.data.store_id).toBe(storeId)
      const product = createProdRes.data.product
      expect(product).toBeDefined()
      expect(product.title).toBe("Test Product")
      // List products for the store
      const listRes = await api.get(
        `/partners/stores/${storeId}/products`,
        { headers: partnerHeaders }
      )
      expect(listRes.status).toBe(200)
      expect(listRes.data.partner_id).toBe(partnerId)
      expect(listRes.data.store_id).toBe(storeId)
      const products = listRes.data.products || []
      expect(Array.isArray(products)).toBe(true)
      // Ensure the created product is present in listing
      expect(products.some((p: any) => p?.product?.id === product.id)).toBe(true)
    })

    it("isolates products and store access across multiple partners", async () => {
      // Partner 1 has already been created in beforeEach and will create product P1
      const p1ProductPayload = {
        store_id: storeId,
        product: {
          title: "P1",
          handle: `p1-${Date.now()}`,
          status: ProductStatus.PUBLISHED,
          options: [
            { title: "Size", values: ["M"] },
          ],
          variants: [
            {
              title: "M",
              sku: `P1-SKU-${Date.now()}`,
              options: { Size: "M" },
              prices: [{ amount: 1500, currency_code: "usd" }],
            },
          ],
        },
      }
      const p1Create = await api.post("/partners/products", p1ProductPayload, { headers: partnerHeaders })
      expect(p1Create.status).toBe(201)
      const p1Product = p1Create.data.product

      // Create Partner 2 with its own store and product P2
      const unique2 = Date.now() + 1
      const partner2Email = `partner2-${unique2}@medusa-test.com`

      await api.post("/auth/partner/emailpass/register", {
        email: partner2Email,
        password: TEST_PARTNER_PASSWORD,
      })
      const login2a = await api.post("/auth/partner/emailpass", {
        email: partner2Email,
        password: TEST_PARTNER_PASSWORD,
      })
      let partner2Headers: Record<string, string> = { Authorization: `Bearer ${login2a.data.token}` }

      const p2Res = await api.post(
        "/partners",
        {
          name: `Bravo ${unique2}`,
          handle: `bravo-${unique2}`,
          admin: { email: partner2Email, first_name: "Admin", last_name: "Bravo" },
        },
        { headers: partner2Headers }
      )
      const partner2Id = p2Res.data.partner.id

      // Fresh token after partner creation
      const login2b = await api.post("/auth/partner/emailpass", {
        email: partner2Email,
        password: TEST_PARTNER_PASSWORD,
      })
      partner2Headers = { Authorization: `Bearer ${login2b.data.token}` }

      // Determine currency for store 2
      const currenciesRes2 = await api.get("/admin/currencies", adminHeaders)
      const currencies2 = currenciesRes2.data.currencies || []
      const usd2 = currencies2.find((c: any) => c.code?.toLowerCase() === "usd")
      const currencyCode2 = String((usd2 || currencies2[0]).code).toLowerCase()

      // Create store 2
      const storePayload2 = {
        store: {
          name: `Bravo Store ${unique2}`,
          supported_currencies: [{ currency_code: currencyCode2, is_default: true }],
          metadata: { test_run: unique2 },
        },
        sales_channel: {
          name: `Bravo ${unique2} - Default`,
          description: "Default sales channel",
        },
        region: {
          name: "Default Region",
          currency_code: currencyCode2,
          countries: ["us"],
        },
        location: {
          name: "Main Warehouse",
          address: { address_1: "456 Second St", city: "LA", postal_code: "90001", country_code: "US" },
        },
      }
      const store2Res = await api.post("/partners/stores", storePayload2, { headers: partner2Headers })
      expect(store2Res.status).toBe(201)
      const store2Id = store2Res.data.store.id

      // Create product P2 for partner 2
      const p2ProductPayload = {
        store_id: store2Id,
        product: {
          title: "P2",
          handle: `p2-${Date.now()}`,
          status: ProductStatus.PUBLISHED,
          options: [{ title: "Size", values: ["L"] }],
          variants: [
            {
              title: "L",
              sku: `P2-SKU-${Date.now()}`,
              options: { Size: "L" },
              prices: [{ amount: 2500, currency_code: "usd" }],
            },
          ],
        },
      }
      const p2Create = await api.post("/partners/products", p2ProductPayload, { headers: partner2Headers })
      expect(p2Create.status).toBe(201)
      const p2Product = p2Create.data.product

      // Partner 1 listing must only include P1
      const p1List = await api.get(`/partners/stores/${storeId}/products`, { headers: partnerHeaders })
      expect(p1List.status).toBe(200)
      const p1Products = p1List.data.products || []
      expect(p1Products.some((l: any) => l?.product?.id === p1Product.id)).toBe(true)
      expect(p1Products.some((l: any) => l?.product?.id === p2Product.id)).toBe(false)

      // Partner 2 listing must only include P2
      const p2List = await api.get(`/partners/stores/${store2Id}/products`, { headers: partner2Headers })
      expect(p2List.status).toBe(200)
      const p2Products = p2List.data.products || []
      expect(p2Products.some((l: any) => l?.product?.id === p2Product.id)).toBe(true)
      expect(p2Products.some((l: any) => l?.product?.id === p1Product.id)).toBe(false)

      // Cross-access should be unauthorized
      const cross1 = await api.get(`/partners/stores/${store2Id}/products`, { headers: partnerHeaders, validateStatus: () => true })
      expect([400, 403]).toContain(cross1.status)
      const cross2 = await api.get(`/partners/stores/${storeId}/products`, { headers: partner2Headers, validateStatus: () => true })
      expect([400, 403]).toContain(cross2.status)
    })
  })
})
