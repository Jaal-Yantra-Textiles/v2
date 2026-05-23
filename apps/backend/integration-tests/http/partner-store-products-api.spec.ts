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

      it("POST /partners/stores/:id/products/quick creates product + variant + price + stock in one shot", async () => {
        const unique = Date.now()
        const res = await api.post(
          `/partners/stores/${partner.storeId}/products/quick`,
          {
            title: `QuickProd ${unique}`,
            description: "Handwoven artisan piece.",
            price: 2500,
            stock_quantity: 17,
          },
          { headers: partner.headers }
        )

        expect(res.status).toBe(201)
        expect(res.data.product).toBeDefined()
        const product = res.data.product
        expect(product.title).toBe(`QuickProd ${unique}`)

        // Read the product back to assert the full shape was composed.
        const detail = await api.get(
          `/partners/stores/${partner.storeId}/products/${product.id}`,
          { headers: partner.headers }
        )
        expect(detail.status).toBe(200)
        const p = detail.data.product
        expect(p.variants.length).toBe(1)
        const variant = p.variants[0]
        const price = (variant.prices || []).find(
          (x: any) => x.currency_code === partner.currencyCode
        )
        expect(price?.amount).toBe(2500)

        // Stock seeded at the partner's default location.
        const invItemId = variant.inventory_items?.[0]?.inventory?.id
        expect(invItemId).toBeDefined()
        const levelsRes = await api.get(
          `/partners/inventory-items/${invItemId}/levels`,
          { headers: partner.headers }
        )
        expect(levelsRes.status).toBe(200)
        const level = (levelsRes.data.inventory_levels || []).find(
          (l: any) => l.location_id === partner.locationId
        )
        expect(level?.stocked_quantity).toBe(17)
      })

      it("POST /partners/stores/:id/products creates a product in the store", async () => {
        const unique = Date.now()
        const res = await api.post(
          `/partners/stores/${partner.storeId}/products`,
          {
            title: `New Product ${unique}`,
            handle: `new-prod-${unique}`,
            status: ProductStatus.DRAFT,
            options: [{ title: "Default option", values: ["Default option value"] }],
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

      it("creates a new variant with prices that persist through admin GET", async () => {
        // Regression test for the "module links causing stress" workaround:
        // partner variant POST previously bypassed createProductVariantsWorkflow
        // and called the bare product service. That skipped the price_set link
        // creation, so admin's /products/:id/prices page crashed with
        // `undefined is not an object (evaluating 'l.prices.reduce')`.
        // The fix routes the create through the workflow, which creates an
        // empty price_set per variant and links it.
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
        // The workflow response includes prices (sourced from the freshly
        // created price_set). Bare service would have returned no prices.
        expect(Array.isArray(res.data.variant.prices)).toBe(true)
        const createdPrice = (res.data.variant.prices || []).find(
          (p: any) => p.currency_code === partner.currencyCode
        )
        expect(createdPrice?.amount).toBe(1400)

        // Verify variant count increased
        const listRes = await api.get(
          `/partners/stores/${partner.storeId}/products/${partner.productId}/variants`,
          { headers: partner.headers }
        )
        expect(listRes.data.variants.length).toBe(3)

        // Critical assertion: admin's GET /admin/products/:id must return the
        // new variant with `prices` as an array (not undefined). Without the
        // price_set link, this field is undefined and the admin UI crashes.
        const adminRes = await api.get(
          `/admin/products/${partner.productId}`,
          adminHeaders
        )
        expect(adminRes.status).toBe(200)
        const adminVariant = (adminRes.data.product.variants || []).find(
          (v: any) => v.sku === `SP-L-${unique}`
        )
        expect(adminVariant).toBeDefined()
        expect(Array.isArray(adminVariant.prices)).toBe(true)
        expect(adminVariant.prices.length).toBeGreaterThan(0)
      })

      it("creates a managed-inventory variant and partner inventory page round-trips (no 404)", async () => {
        // Regression test for the inventory_level gap surfaced by the
        // variant ↔ price_set fix. createProductVariantsWorkflow creates
        // the inventory item and links variant ↔ item, but NOT the
        // inventory_level row at the partner's location. The partner-ui's
        // inventory detail route (`/partners/inventory-items/:id`) treats
        // missing levels as 404, blocking stock updates entirely.
        const unique = Date.now()
        const res = await api.post(
          `/partners/stores/${partner.storeId}/products/${partner.productId}/variants`,
          {
            title: "Managed",
            sku: `SP-MGD-${unique}`,
            options: { Size: "L" },
            manage_inventory: true,
          },
          { headers: partner.headers }
        )
        expect(res.status).toBe(201)

        // Locate the freshly-created inventory item via the partner variant
        // detail GET (which expands inventory_items.inventory).
        const variantId = res.data.variant.id
        const variantRes = await api.get(
          `/partners/stores/${partner.storeId}/products/${partner.productId}/variants/${variantId}`,
          { headers: partner.headers }
        )
        const inventoryItemId =
          variantRes.data.variant?.inventory_items?.[0]?.inventory?.id ??
          variantRes.data.variant?.inventory_items?.[0]?.inventory_item_id
        expect(inventoryItemId).toBeDefined()

        // The 404 repro: GET /partners/inventory-items/:id must now succeed
        // because the helper created the inventory_level at the partner's
        // default location.
        const inventoryRes = await api.get(
          `/partners/inventory-items/${inventoryItemId}`,
          { headers: partner.headers }
        )
        expect(inventoryRes.status).toBe(200)
        expect(inventoryRes.data.inventory_item?.location_levels?.length).toBeGreaterThan(0)

        // And the partner can actually adjust stock on that level.
        const locationId =
          inventoryRes.data.inventory_item.location_levels[0].location_id
        const adjustRes = await api.post(
          `/partners/inventory-items/${inventoryItemId}/levels/${locationId}`,
          { stocked_quantity: 42 },
          { headers: partner.headers }
        )
        expect(adjustRes.status).toBe(200)
      })

      it("creates a variant WITHOUT prices and admin still sees prices: []", async () => {
        // The exact admin-crash scenario: a partner adds a variant but enters
        // no price. The bare-service path created a variant with no price_set
        // link → admin's GET returned variant.prices === undefined → the
        // /products/:id/prices page crashed on `variant.prices.reduce(...)`.
        // With the workflow, an empty price_set is created and linked, so
        // admin sees `prices: []` and renders the empty-price row safely.
        const unique = Date.now()
        const res = await api.post(
          `/partners/stores/${partner.storeId}/products/${partner.productId}/variants`,
          {
            title: "Priceless",
            sku: `SP-P-${unique}`,
            options: { Size: "L" },
            // No `prices` field at all
          },
          { headers: partner.headers }
        )
        expect(res.status).toBe(201)
        expect(res.data.variant.title).toBe("Priceless")

        const adminRes = await api.get(
          `/admin/products/${partner.productId}`,
          adminHeaders
        )
        const adminVariant = (adminRes.data.product.variants || []).find(
          (v: any) => v.sku === `SP-P-${unique}`
        )
        expect(adminVariant).toBeDefined()
        // The field MUST be a defined array (even if empty) so the admin's
        // `variant.prices.reduce` doesn't throw.
        expect(Array.isArray(adminVariant.prices)).toBe(true)
        expect(adminVariant.prices.length).toBe(0)
      })

      it("updates a variant including prices", async () => {
        // The single-variant UPDATE used to call the bare product service,
        // which silently dropped any `prices` field (the product module has
        // no knowledge of the pricing module). Now it goes through
        // updateProductVariantsWorkflow, which properly threads prices
        // through updatePriceSetsStep.
        const variantId = partner.variantIds[0]
        const res = await api.post(
          `/partners/stores/${partner.storeId}/products/${partner.productId}/variants/${variantId}`,
          {
            title: "Extra Small",
            prices: [{ amount: 4242, currency_code: partner.currencyCode }],
          },
          { headers: partner.headers }
        )
        expect(res.status).toBe(200)
        expect(res.data.variant.title).toBe("Extra Small")

        // Verify the price update actually persisted (bare service would
        // have silently dropped it).
        const listRes = await api.get(
          `/partners/stores/${partner.storeId}/products/${partner.productId}/variants`,
          { headers: partner.headers }
        )
        const updated = listRes.data.variants.find(
          (v: any) => v.id === variantId
        )
        const updatedPrice = (updated?.prices || []).find(
          (p: any) => p.currency_code === partner.currencyCode
        )
        expect(updatedPrice?.amount).toBe(4242)
      })

      it("POST /variants/batch updates multiple variant prices in one call", async () => {
        const res = await api.post(
          `/partners/stores/${partner.storeId}/products/${partner.productId}/variants/batch`,
          {
            update: partner.variantIds.map((id: string, i: number) => ({
              id,
              prices: [{ amount: 9000 + i, currency_code: partner.currencyCode }],
            })),
          },
          { headers: partner.headers }
        )

        expect(res.status).toBe(200)
        expect(Array.isArray(res.data.updated)).toBe(true)
        expect(res.data.updated.length).toBe(partner.variantIds.length)

        const updatedIds = res.data.updated.map((v: any) => v.id).sort()
        expect(updatedIds).toEqual([...partner.variantIds].sort())

        // Verify persisted prices reflect the new amounts
        const firstVariant = res.data.updated.find(
          (v: any) => v.id === partner.variantIds[0]
        )
        const matched = (firstVariant?.prices || []).find(
          (p: any) => p.currency_code === partner.currencyCode
        )
        expect(matched?.amount).toBe(9000)
      })

      it("region-scoped price round-trips with rules object", async () => {
        // Use the store's existing region (US was created in setup)
        const regionsRes = await api.get(
          `/partners/stores/${partner.storeId}/regions`,
          { headers: partner.headers }
        )
        expect(regionsRes.status).toBe(200)
        const regionId = regionsRes.data.regions?.[0]?.id
        expect(regionId).toBeDefined()

        // Write a region-scoped price via batch
        const variantId = partner.variantIds[0]
        const batchRes = await api.post(
          `/partners/stores/${partner.storeId}/products/${partner.productId}/variants/batch`,
          {
            update: [
              {
                id: variantId,
                prices: [
                  {
                    amount: 7777,
                    currency_code: partner.currencyCode,
                    rules: { region_id: regionId },
                  },
                ],
              },
            ],
          },
          { headers: partner.headers }
        )
        expect(batchRes.status).toBe(200)

        // The critical assertion: reading the product back must expose
        // `rules.region_id` so the pricing UI can map the price to its
        // region column. `rules_count` alone is not enough — the UI needs
        // the flat rules object reconstructed from price_rules.
        const productRes = await api.get(
          `/partners/stores/${partner.storeId}/products/${partner.productId}`,
          { headers: partner.headers }
        )
        expect(productRes.status).toBe(200)
        const v = productRes.data.product.variants.find(
          (x: any) => x.id === variantId
        )
        const regionalPrice = (v?.prices || []).find(
          (p: any) =>
            p.currency_code === partner.currencyCode && p.rules?.region_id === regionId
        )
        expect(regionalPrice).toBeDefined()
        expect(regionalPrice.amount).toBe(7777)
        expect(regionalPrice.rules).toEqual({ region_id: regionId })
      })

      it("POST /variants/batch rejects cross-partner writes", async () => {
        const other = await createPartnerWithStoreAndProduct(api, adminHeaders)
        const res = await api.post(
          `/partners/stores/${other.storeId}/products/${other.productId}/variants/batch`,
          {
            update: [{ id: other.variantIds[0], title: "Hijacked" }],
          },
          { headers: partner.headers, validateStatus: () => true }
        )
        expect([400, 401, 403]).toContain(res.status)
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
