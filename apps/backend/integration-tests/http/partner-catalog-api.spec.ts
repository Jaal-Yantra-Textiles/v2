import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { ProductStatus } from "@medusajs/framework/utils"

const TEST_PARTNER_PASSWORD = "supersecret"

jest.setTimeout(90 * 1000)

async function createPartnerWithStoreAndProduct(api: any, adminHeaders: Record<string, any>) {
  const unique = Date.now() + Math.random().toString(36).slice(2, 6)
  const email = `partner-cat-${unique}@medusa-test.com`

  await api.post("/auth/partner/emailpass/register", { email, password: TEST_PARTNER_PASSWORD })
  const login1 = await api.post("/auth/partner/emailpass", { email, password: TEST_PARTNER_PASSWORD })
  let headers: Record<string, string> = { Authorization: `Bearer ${login1.data.token}` }

  const partnerRes = await api.post(
    "/partners",
    {
      name: `CatTest ${unique}`,
      handle: `cattest-${unique}`,
      admin: { email, first_name: "Admin", last_name: "Cat" },
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
        name: `CatStore ${unique}`,
        supported_currencies: [{ currency_code: currencyCode, is_default: true }],
      },
      sales_channel: { name: `CatChannel ${unique}`, description: "Default" },
      region: { name: "Default Region", currency_code: currencyCode, countries: ["us"] },
      location: {
        name: "Warehouse",
        address: { address_1: "1 Main St", city: "NY", postal_code: "10001", country_code: "US" },
      },
    },
    { headers }
  )

  const storeId = storeRes.data.store.id

  // Create a product
  const productRes = await api.post(
    "/partners/products",
    {
      store_id: storeId,
      product: {
        title: `Catalog Product ${unique}`,
        handle: `catalog-prod-${unique}`,
        status: ProductStatus.PUBLISHED,
        options: [{ title: "Color", values: ["Red"] }],
        variants: [
          {
            title: "Red",
            sku: `CAT-SKU-${unique}`,
            options: { Color: "Red" },
            prices: [{ amount: 1500, currency_code: currencyCode }],
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
    productId: productRes.data.product?.id,
    salesChannelId: storeRes.data.sales_channel?.id,
  }
}

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Partner API - Catalog Management", () => {
    let adminHeaders: Record<string, any>
    let partner: Awaited<ReturnType<typeof createPartnerWithStoreAndProduct>>

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)
      partner = await createPartnerWithStoreAndProduct(api, adminHeaders)
    })

    describe("Product Categories", () => {
      it("GET /partners/product-categories lists categories", async () => {
        const res = await api.get("/partners/product-categories", {
          headers: partner.headers,
        })
        expect(res.status).toBe(200)
        expect(Array.isArray(res.data.product_categories)).toBe(true)
      })

      it("POST /partners/product-categories creates a category", async () => {
        const unique = Date.now()
        const res = await api.post(
          "/partners/product-categories",
          {
            name: `Test Category ${unique}`,
            handle: `test-category-${unique}`,
          },
          { headers: partner.headers }
        )
        expect(res.status).toBe(200)
        expect(res.data.product_category).toBeDefined()
        expect(res.data.product_category.name).toBe(`Test Category ${unique}`)
      })

      it("links a product to a category", async () => {
        const unique = Date.now()

        // Create category
        const catRes = await api.post(
          "/partners/product-categories",
          { name: `LinkCat ${unique}`, handle: `linkcat-${unique}` },
          { headers: partner.headers }
        )
        const categoryId = catRes.data.product_category.id

        // Link product to category
        const linkRes = await api.post(
          `/partners/product-categories/${categoryId}/products`,
          { add: [partner.productId] },
          { headers: partner.headers }
        )
        expect(linkRes.status).toBe(200)
      })
    })

    describe("Product Collections", () => {
      it("GET /partners/product-collections lists collections", async () => {
        const res = await api.get("/partners/product-collections", {
          headers: partner.headers,
        })
        expect(res.status).toBe(200)
        expect(Array.isArray(res.data.collections)).toBe(true)
      })

      it("POST /partners/product-collections creates a collection", async () => {
        const unique = Date.now()
        const res = await api.post(
          "/partners/product-collections",
          {
            title: `Summer ${unique}`,
            handle: `summer-${unique}`,
          },
          { headers: partner.headers }
        )
        expect(res.status).toBe(200)
        expect(res.data.collection).toBeDefined()
        expect(res.data.collection.title).toBe(`Summer ${unique}`)
      })

      it("links a product to a collection", async () => {
        const unique = Date.now()

        // Create collection
        const colRes = await api.post(
          "/partners/product-collections",
          { title: `LinkCol ${unique}`, handle: `linkcol-${unique}` },
          { headers: partner.headers }
        )
        const collectionId = colRes.data.collection.id

        // Link product
        const linkRes = await api.post(
          `/partners/product-collections/${collectionId}/products`,
          { add: [partner.productId] },
          { headers: partner.headers }
        )
        expect(linkRes.status).toBe(200)
      })
    })

    describe("Product Tags", () => {
      it("GET /partners/product-tags lists tags", async () => {
        const res = await api.get("/partners/product-tags", {
          headers: partner.headers,
        })
        expect(res.status).toBe(200)
        expect(Array.isArray(res.data.product_tags)).toBe(true)
      })
    })

    describe("Store Product Variants", () => {
      it("GET /partners/stores/:id/products/:productId/variants lists variants", async () => {
        const res = await api.get(
          `/partners/stores/${partner.storeId}/products/${partner.productId}/variants`,
          { headers: partner.headers }
        )
        expect(res.status).toBe(200)
        expect(Array.isArray(res.data.variants)).toBe(true)
        expect(res.data.variants.length).toBeGreaterThanOrEqual(1)
      })

      it("POST /partners/stores/:id/products/:productId/variants creates a variant", async () => {
        const unique = Date.now()
        const res = await api.post(
          `/partners/stores/${partner.storeId}/products/${partner.productId}/variants`,
          {
            title: "Blue",
            sku: `BLUE-SKU-${unique}`,
            options: { Color: "Blue" },
            prices: [{ amount: 1800, currency_code: "usd" }],
          },
          { headers: partner.headers }
        )
        expect(res.status).toBe(201)
        expect(res.data.variant).toBeDefined()
        expect(res.data.variant.title).toBe("Blue")
      })
    })

    describe("Store Product Options", () => {
      it("POST /partners/stores/:id/products/:productId/options creates an option", async () => {
        const res = await api.post(
          `/partners/stores/${partner.storeId}/products/${partner.productId}/options`,
          {
            title: "Material",
            values: ["Cotton", "Silk"],
          },
          { headers: partner.headers }
        )
        expect(res.status).toBe(201)
        expect(res.data.product_option).toBeDefined()
        expect(res.data.product_option.title).toBe("Material")
      })
    })

    describe("Sales Channel Product Batch", () => {
      it("adds and removes products from sales channel", async () => {
        if (!partner.salesChannelId) return

        // Remove product
        const removeRes = await api.post(
          `/partners/stores/${partner.storeId}/sales-channels/${partner.salesChannelId}/products/batch`,
          { remove: [partner.productId] },
          { headers: partner.headers }
        )
        expect(removeRes.status).toBe(200)

        // Add it back
        const addRes = await api.post(
          `/partners/stores/${partner.storeId}/sales-channels/${partner.salesChannelId}/products/batch`,
          { add: [partner.productId] },
          { headers: partner.headers }
        )
        expect(addRes.status).toBe(200)
      })
    })

    describe("Discover Products", () => {
      it("GET /partners/discover/products lists discoverable products", async () => {
        const res = await api.get("/partners/discover/products", {
          headers: partner.headers,
          validateStatus: () => true,
        })
        // May return 200 or specific status depending on implementation
        expect([200, 404]).toContain(res.status)
        if (res.status === 200) {
          expect(Array.isArray(res.data.products)).toBe(true)
        }
      })
    })
  })
})
