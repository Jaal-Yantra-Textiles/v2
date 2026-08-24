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
        // The payload is now shaped by `list-store-products` itself so the admin
        // inspection mirror serves the identical body (#843); `store_id` says
        // which store the catalog came from.
        expect(res.data.count).toBe(products.length)
        expect(res.data.store_id).toBe(partner.storeId)
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
        // #1124 — the provenance trail (product↔production_run link) is wired
        // through the remap as an array (empty here — no fulfilled orders yet).
        expect(Array.isArray(res.data.product.production_runs)).toBe(true)
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

      // The MCP tool `update_store_product` declares `bodyParams: ["product",
      // "metadata"]`, so a model's write arrives NESTED. The route used to pass
      // the raw body straight to `updateProducts`, which ignores unknown keys
      // without throwing — so the call returned 200 with the product echoed
      // back UNCHANGED and wrote nothing. Verified broken on prod before the
      // fix. Asserting on the response is what hid it: the read-back below is
      // the assertion that catches it.
      it("accepts the MCP-shaped NESTED body and actually persists it", async () => {
        const res = await api.post(
          `/partners/stores/${partner.storeId}/products/${partner.productId}`,
          { product: { title: "Nested Shape Title", subtitle: "nested-ok" } },
          { headers: partner.headers }
        )
        expect(res.status).toBe(200)

        const readBack = await api.get(
          `/partners/stores/${partner.storeId}/products/${partner.productId}`,
          { headers: partner.headers }
        )
        expect(readBack.data.product.title).toBe("Nested Shape Title")
        expect(readBack.data.product.subtitle).toBe("nested-ok")
      })

      it("keeps top-level metadata when the body is nested", async () => {
        const res = await api.post(
          `/partners/stores/${partner.storeId}/products/${partner.productId}`,
          {
            product: { title: "Nested With Metadata" },
            metadata: { b2b_min_order_qty: 50 },
          },
          { headers: partner.headers }
        )
        expect(res.status).toBe(200)

        const readBack = await api.get(
          `/partners/stores/${partner.storeId}/products/${partner.productId}`,
          { headers: partner.headers }
        )
        expect(readBack.data.product.title).toBe("Nested With Metadata")
        expect(readBack.data.product.metadata?.b2b_min_order_qty).toBe(50)
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
        // HTTP 200 alone is not enough — the inventory module's
        // `updateInventoryLevels` takes a single arg (selector + new
        // values merged). Earlier the route passed them as two args, so
        // the value was silently dropped and the response was a 200 with
        // no actual change. We re-GET to assert the stocked_quantity
        // persisted.
        const locationId =
          inventoryRes.data.inventory_item.location_levels[0].location_id
        const adjustRes = await api.post(
          `/partners/inventory-items/${inventoryItemId}/levels/${locationId}`,
          { stocked_quantity: 42 },
          { headers: partner.headers }
        )
        expect(adjustRes.status).toBe(200)

        const verifyRes = await api.get(
          `/partners/inventory-items/${inventoryItemId}`,
          { headers: partner.headers }
        )
        const level = (verifyRes.data.inventory_item.location_levels || []).find(
          (l: any) => l.location_id === locationId
        )
        expect(level?.stocked_quantity).toBe(42)
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
      // 🔑 The assertion this suite shipped with checked the 201 and the title
      // in the RESPONSE, and never re-read the product. Product options went
      // global in 2.16 — the route wrote `product_id`, which is a no-op — so it
      // stayed green for months while every partner attempt to add an option
      // changed nothing. Every test here re-reads the product.
      const readOptions = async () => {
        const res = await api.get(
          `/partners/stores/${partner.storeId}/products/${partner.productId}`,
          { headers: partner.headers }
        )
        return (res.data.product.options || []) as any[]
      }

      // ⚠️ One test, not three. The runner restores a snapshot before every
      // test, so a chain split across `it`s reads as a convincing false
      // "the option vanished" bug.
      it("adds an option, merges a re-add, and saves an edited value", async () => {
        // 1. Create — and the product must actually carry it.
        const created = await api.post(
          `/partners/stores/${partner.storeId}/products/${partner.productId}/options`,
          { title: "Material", values: ["Cotton", "Polyester"] },
          { headers: partner.headers }
        )
        expect(created.status).toBe(201)
        expect(created.data.product_option.title).toBe("Material")

        let onProduct = (await readOptions()).find((o) => o.title === "Material")
        expect(onProduct).toBeDefined()
        expect((onProduct.values || []).map((v: any) => v.value).sort()).toEqual(
          ["Cotton", "Polyester"]
        )

        // 2. Re-adding the same title merges instead of colliding. On the old
        // route this hit the global unique title index and answered 400, which
        // is what pushed the assistant into add_product_variant instead.
        const reused = await api.post(
          `/partners/stores/${partner.storeId}/products/${partner.productId}/options`,
          { title: "Material", values: ["Cotton", "Silk"] },
          { headers: partner.headers }
        )
        expect(reused.status).toBe(200)
        expect(reused.data.reused).toBe(true)

        onProduct = (await readOptions()).find((o) => o.title === "Material")
        expect((onProduct.values || []).map((v: any) => v.value).sort()).toEqual(
          ["Cotton", "Polyester", "Silk"]
        )

        // 3. Editing values changes what the PRODUCT carries. The old route
        // answered 200 with the new value in the body while the product still
        // listed the old ones — the partner's "save button does nothing".
        const saved = await api.post(
          `/partners/stores/${partner.storeId}/products/${partner.productId}/options/${onProduct.id}`,
          { title: "Material", values: ["Cotton", "Polyester", "Silk", "Linen"] },
          { headers: partner.headers }
        )
        expect(saved.status).toBe(200)

        onProduct = (await readOptions()).find((o) => o.title === "Material")
        expect((onProduct.values || []).map((v: any) => v.value).sort()).toEqual(
          ["Cotton", "Linen", "Polyester", "Silk"]
        )
      })

      // Colour is ONE shared row every partner links, with a per-product value
      // subset. Again one test: the runner rolls the DB back between them.
      it("links the curated Colour palette with only the chosen subset", async () => {
        const productService: any = getSharedTestEnv()
          .getContainer()
          .resolve("product")

        await productService.createProductOptions({
          title: "Colour",
          is_exclusive: false,
          values: [
            { value: "Ivory", metadata: { hex: "#FAF8EF" } },
            { value: "Terracotta", metadata: { hex: "#BF7B61" } },
            { value: "Emerald", metadata: { hex: "#0EA347" } },
          ],
        })

        const res = await api.post(
          `/partners/stores/${partner.storeId}/products/${partner.productId}/options`,
          { title: "Colour", values: ["Ivory", "Terracotta"] },
          { headers: partner.headers }
        )
        expect(res.status).toBe(201)

        // ⚠️ Omitting the value-id subset links ALL of the option's values.
        // The product asked for two of three and must get exactly two.
        const onProduct = (await readOptions()).find((o) => o.title === "Colour")
        expect((onProduct.values || []).map((v: any) => v.value).sort()).toEqual(
          ["Ivory", "Terracotta"]
        )
        expect(
          (onProduct.values || []).find((v: any) => v.value === "Ivory")
            ?.metadata?.hex
        ).toBe("#FAF8EF")

        // A colour outside the palette is refused — with the vocabulary named.
        const refused = await api.post(
          `/partners/stores/${partner.storeId}/products/${partner.productId}/options`,
          { title: "Colour", values: ["Neon Lime"] },
          { headers: partner.headers, validateStatus: () => true }
        )
        expect(refused.status).toBe(400)
        expect(refused.data.message).toContain("Neon Lime")

        // ...unless the partner supplies a hex, which is the escape hatch.
        const added = await api.post(
          `/partners/stores/${partner.storeId}/products/${partner.productId}/options`,
          {
            title: "Colour",
            values: [{ value: "Sea Green", hex: "#2E8B57" }],
          },
          { headers: partner.headers }
        )
        expect(added.status).toBe(200)

        const withCustom = (await readOptions()).find(
          (o) => o.title === "Colour"
        )
        const seaGreen = (withCustom.values || []).find(
          (v: any) => v.value === "Sea Green"
        )
        // The hex must survive: core's add path reads only `value` and drops
        // metadata, so this only passes because it is set in a second write.
        expect(seaGreen?.metadata?.hex).toBe("#2E8B57")
        expect(seaGreen?.metadata?.custom).toBe(true)

        // A shared option must not be renamable from one partner's product.
        const rename = await api.post(
          `/partners/stores/${partner.storeId}/products/${partner.productId}/options/${withCustom.id}`,
          { title: "Colours" },
          { headers: partner.headers, validateStatus: () => true }
        )
        expect(rename.status).toBe(400)
      })

      it("refuses to write an option that belongs to another product", async () => {
        const other = await createPartnerWithStoreAndProduct(api, adminHeaders)
        const res = await api.post(
          `/partners/stores/${partner.storeId}/products/${partner.productId}/options/${other.optionIds[0]}`,
          { title: "Hijacked" },
          { headers: partner.headers, validateStatus: () => true }
        )
        expect([400, 404]).toContain(res.status)
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
        expect([401, 403]).toContain(res.status)
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
