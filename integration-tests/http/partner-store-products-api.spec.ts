import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { ProductStatus } from "@medusajs/framework/utils"

const TEST_PARTNER_PASSWORD = "supersecret"

jest.setTimeout(90 * 1000)

async function createPartnerWithStoreAndProduct(api: any, adminHeaders: Record<string, any>) {
  const unique = Date.now() + Math.random().toString(36).slice(2, 6)
  const email = `partner-sp-${unique}@medusa-test.com`

  await api.post("/auth/partner/emailpass/register", { email, password: TEST_PARTNER_PASSWORD })
  const login1 = await api.post("/auth/partner/emailpass", { email, password: TEST_PARTNER_PASSWORD })
  let headers: Record<string, string> = { Authorization: `Bearer ${login1.data.token}` }

  const partnerRes = await api.post(
    "/partners",
    {
      name: `SPTest ${unique}`,
      handle: `sptest-${unique}`,
      admin: { email, first_name: "Admin", last_name: "SP" },
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
        name: `SPStore ${unique}`,
        supported_currencies: [{ currency_code: currencyCode, is_default: true }],
      },
      sales_channel: { name: `SPChannel ${unique}`, description: "Default" },
      region: { name: "Default Region", currency_code: currencyCode, countries: ["us"] },
      location: {
        name: "Warehouse",
        address: { address_1: "1 Main St", city: "NY", postal_code: "10001", country_code: "US" },
      },
    },
    { headers }
  )

  const storeId = storeRes.data.store.id

  // Create a product with multiple options
  const productRes = await api.post(
    "/partners/products",
    {
      store_id: storeId,
      product: {
        title: `SP Product ${unique}`,
        handle: `sp-prod-${unique}`,
        status: ProductStatus.PUBLISHED,
        options: [
          { title: "Size", values: ["S", "M", "L"] },
        ],
        variants: [
          {
            title: "Small",
            sku: `SP-S-${unique}`,
            options: { Size: "S" },
            prices: [{ amount: 1000, currency_code: currencyCode }],
          },
          {
            title: "Medium",
            sku: `SP-M-${unique}`,
            options: { Size: "M" },
            prices: [{ amount: 1200, currency_code: currencyCode }],
          },
        ],
      },
    },
    { headers }
  )

  const product = productRes.data.product

  return {
    headers,
    partnerId,
    storeId,
    currencyCode,
    productId: product?.id,
    variantIds: (product?.variants || []).map((v: any) => v.id),
    optionIds: (product?.options || []).map((o: any) => o.id),
    salesChannelId: storeRes.data.sales_channel?.id,
    locationId: storeRes.data.location?.id,
  }
}

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Partner API - Store Product Management", () => {
    let adminHeaders: Record<string, any>
    let partner: Awaited<ReturnType<typeof createPartnerWithStoreAndProduct>>

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)
      partner = await createPartnerWithStoreAndProduct(api, adminHeaders)
    })

    describe("Store Products CRUD", () => {
      it("GET /partners/stores/:id/products lists products in the store", async () => {
        const res = await api.get(`/partners/stores/${partner.storeId}/products`, {
          headers: partner.headers,
        })
        expect(res.status).toBe(200)
        const products = res.data.products || []
        expect(Array.isArray(products)).toBe(true)
        expect(products.length).toBeGreaterThanOrEqual(1)
      })

      it("POST /partners/stores/:id/products creates a product in the store", async () => {
        const unique = Date.now()
        const res = await api.post(
          `/partners/stores/${partner.storeId}/products`,
          {
            title: `New Product ${unique}`,
            handle: `new-prod-${unique}`,
            status: ProductStatus.DRAFT,
          },
          { headers: partner.headers }
        )
        expect(res.status).toBe(201)
        expect(res.data.product).toBeDefined()
        expect(res.data.product.title).toBe(`New Product ${unique}`)
        expect(res.data.product.status).toBe("draft")
      })

      it("GET /partners/stores/:id/products/:productId returns a single product", async () => {
        const res = await api.get(
          `/partners/stores/${partner.storeId}/products/${partner.productId}`,
          { headers: partner.headers }
        )
        expect(res.status).toBe(200)
        expect(res.data.product).toBeDefined()
        expect(res.data.product.id).toBe(partner.productId)
      })

      it("POST /partners/stores/:id/products/:productId updates the product", async () => {
        const res = await api.post(
          `/partners/stores/${partner.storeId}/products/${partner.productId}`,
          { title: "Updated Product Title" },
          { headers: partner.headers }
        )
        expect(res.status).toBe(200)
        expect(res.data.product.title).toBe("Updated Product Title")
      })
    })

    describe("Product Variant Management", () => {
      it("lists variants for a product", async () => {
        const res = await api.get(
          `/partners/stores/${partner.storeId}/products/${partner.productId}/variants`,
          { headers: partner.headers }
        )
        expect(res.status).toBe(200)
        expect(res.data.variants.length).toBe(2) // S and M created in setup
      })

      it("creates a new variant", async () => {
        const unique = Date.now()
        const res = await api.post(
          `/partners/stores/${partner.storeId}/products/${partner.productId}/variants`,
          {
            title: "Large",
            sku: `SP-L-${unique}`,
            options: { Size: "L" },
            prices: [{ amount: 1400, currency_code: partner.currencyCode }],
          },
          { headers: partner.headers }
        )
        expect(res.status).toBe(201)
        expect(res.data.variant).toBeDefined()
        expect(res.data.variant.title).toBe("Large")

        // Verify variant count increased
        const listRes = await api.get(
          `/partners/stores/${partner.storeId}/products/${partner.productId}/variants`,
          { headers: partner.headers }
        )
        expect(listRes.data.variants.length).toBe(3)
      })

      it("updates a variant", async () => {
        const variantId = partner.variantIds[0]
        const res = await api.post(
          `/partners/stores/${partner.storeId}/products/${partner.productId}/variants/${variantId}`,
          { title: "Extra Small" },
          { headers: partner.headers }
        )
        expect(res.status).toBe(200)
        expect(res.data.variant.title).toBe("Extra Small")
      })
    })

    describe("Product Option Management", () => {
      it("creates a new option for the product", async () => {
        const res = await api.post(
          `/partners/stores/${partner.storeId}/products/${partner.productId}/options`,
          {
            title: "Material",
            values: ["Cotton", "Polyester"],
          },
          { headers: partner.headers }
        )
        expect(res.status).toBe(201)
        expect(res.data.product_option).toBeDefined()
        expect(res.data.product_option.title).toBe("Material")
      })
    })

    describe("Store Product Variants List", () => {
      it("GET /partners/stores/:id/product-variants lists all variants across products", async () => {
        const res = await api.get(
          `/partners/stores/${partner.storeId}/product-variants`,
          { headers: partner.headers }
        )
        expect(res.status).toBe(200)
        expect(Array.isArray(res.data.variants)).toBe(true)
        expect(res.data.variants.length).toBeGreaterThanOrEqual(2)
      })
    })

    describe("Cross-Partner Product Isolation", () => {
      it("partner cannot access another partner's store products", async () => {
        // Create a second partner
        const other = await createPartnerWithStoreAndProduct(api, adminHeaders)

        // Partner 1 tries to access Partner 2's store products
        const res = await api.get(
          `/partners/stores/${other.storeId}/products`,
          {
            headers: partner.headers,
            validateStatus: () => true,
          }
        )
        expect([400, 403]).toContain(res.status)
      })
    })

    describe("Location Sales Channels", () => {
      it("POST /partners/stores/:id/locations/:locId/sales-channels links channels", async () => {
        if (!partner.salesChannelId) return

        const res = await api.post(
          `/partners/stores/${partner.storeId}/locations/${partner.locationId}/sales-channels`,
          { add: [partner.salesChannelId] },
          { headers: partner.headers }
        )
        expect(res.status).toBe(200)
        expect(res.data.stock_location).toBeDefined()
      })
    })
  })
})
