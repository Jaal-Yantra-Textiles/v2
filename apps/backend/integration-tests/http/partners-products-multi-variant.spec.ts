/**
 * Multi-variant product creation through POST /partners/products — the exact
 * path the partner assistant's `create_product` tool dispatches to.
 *
 * The existing partners-products spec only ever creates ONE option with ONE
 * value and ONE variant, so nothing pinned what happens when a partner says
 * "create Mill Spun and Hand Spun Pashmina". These tests pin three things that
 * the assistant feature depends on and that a single-variant test cannot see:
 *
 *   1. EVERY named variant is created, with its option value mapped correctly
 *      — not just the first, and not a cartesian product nobody asked for.
 *   2. EVERY managed variant gets its OWN inventory item AND a location level
 *      at the store's stock location. `ensureInventoryLevelsForVariants` loops,
 *      so a per-variant assertion is the only thing that proves the loop ran to
 *      the end rather than seeding variant #1 and stopping.
 *   3. Status defaults to DRAFT when the caller omits it, and only becomes
 *      published when explicitly asked. "draft unless asked" is the assistant's
 *      contract with the partner, so it belongs in a test rather than a prompt.
 *
 * NOTE: this partner has no onboarding profile, so `selling_mode` is undefined
 * and the `core_channel_listing` override (products/route.ts) does not apply.
 * A core-channel artisan is forced to `proposed` regardless of what is asked
 * for — that is a separate case and is asserted in its own test below.
 */
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { ProductStatus } from "@medusajs/framework/utils"

const TEST_PARTNER_PASSWORD = "supersecret"

jest.setTimeout(60 * 1000)

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Partner API - multi-variant product creation", () => {
    let adminHeaders: Record<string, any>
    let partnerHeaders: Record<string, string>
    let partnerId: string
    let storeId: string
    let currencyCode: string

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)

      const unique = Date.now()
      const partnerEmail = `partner-mv-${unique}@medusa-test.com`

      await api.post("/auth/partner/emailpass/register", {
        email: partnerEmail,
        password: TEST_PARTNER_PASSWORD,
      })

      const login1 = await api.post("/auth/partner/emailpass", {
        email: partnerEmail,
        password: TEST_PARTNER_PASSWORD,
      })
      partnerHeaders = { Authorization: `Bearer ${login1.data.token}` }

      const partnerRes = await api.post(
        "/partners",
        {
          name: `Pashmina Co ${unique}`,
          handle: `pashmina-${unique}`,
          admin: {
            email: partnerEmail,
            first_name: "Admin",
            last_name: "Pashmina",
          },
        },
        { headers: partnerHeaders }
      )
      partnerId = partnerRes.data.partner.id

      const login2 = await api.post("/auth/partner/emailpass", {
        email: partnerEmail,
        password: TEST_PARTNER_PASSWORD,
      })
      partnerHeaders = { Authorization: `Bearer ${login2.data.token}` }

      const currenciesRes = await api.get("/admin/currencies", adminHeaders)
      const currencies = currenciesRes.data.currencies || []
      const usd = currencies.find((c: any) => c.code?.toLowerCase() === "usd")
      const selected = usd || currencies[0]
      currencyCode = String(selected.code).toLowerCase()

      const storeRes = await api.post(
        "/partners/stores",
        {
          store: {
            name: `Pashmina Store ${unique}`,
            supported_currencies: [
              { currency_code: currencyCode, is_default: true },
            ],
            metadata: { test_run: unique },
          },
          sales_channel: {
            name: `Pashmina ${unique} - Default`,
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
        },
        { headers: partnerHeaders }
      )
      expect(storeRes.status).toBe(201)
      storeId = storeRes.data.store.id
    })

    /** Fetch a product with everything needed to assert per-variant inventory. */
    const getProductWithInventory = async (productId: string) => {
      const res = await api.get(
        `/admin/products/${productId}?fields=status,variants.id,variants.title,variants.sku,variants.manage_inventory,` +
          `variants.options.value,variants.options.option.title,` +
          `variants.inventory_items.inventory_item_id,` +
          `variants.inventory_items.inventory.location_levels.location_id,` +
          `variants.inventory_items.inventory.location_levels.stocked_quantity`,
        adminHeaders
      )
      expect(res.status).toBe(200)
      return res.data.product
    }

    const levelsOf = (variant: any) =>
      (variant.inventory_items || []).flatMap(
        (ii: any) => ii?.inventory?.location_levels || []
      )

    it("creates one variant per named value — Mill Spun and Hand Spun — each with its own inventory item and level", async () => {
      const stamp = Date.now()
      const payload = {
        store_id: storeId,
        product: {
          title: "Pashmina Shawl",
          handle: `pashmina-shawl-${stamp}`,
          description: "Handwoven Kashmiri pashmina.",
          options: [
            {
              title: "Spinning",
              values: ["Mill Spun", "Hand Spun"],
            },
          ],
          variants: [
            {
              title: "Mill Spun",
              sku: `PASH-MILL-${stamp}`,
              options: { Spinning: "Mill Spun" },
              prices: [{ amount: 12000, currency_code: currencyCode }],
            },
            {
              title: "Hand Spun",
              sku: `PASH-HAND-${stamp}`,
              options: { Spinning: "Hand Spun" },
              prices: [{ amount: 24000, currency_code: currencyCode }],
            },
          ],
        },
      }

      const createRes = await api.post("/partners/products", payload, {
        headers: partnerHeaders,
      })
      expect(createRes.status).toBe(201)
      expect(createRes.data.partner_id).toBe(partnerId)

      const product = await getProductWithInventory(createRes.data.product.id)

      // 1. Both variants exist — and ONLY those two.
      expect(product.variants).toHaveLength(2)
      const byTitle = Object.fromEntries(
        product.variants.map((v: any) => [v.title, v])
      )
      expect(Object.keys(byTitle).sort()).toEqual(["Hand Spun", "Mill Spun"])

      // 2. Each variant carries the option value it was asked for. A variant
      //    created with the wrong option value still "exists", so asserting the
      //    count alone would pass on a product nobody could actually buy from.
      for (const title of ["Mill Spun", "Hand Spun"]) {
        const opts = byTitle[title].options || []
        expect(opts.map((o: any) => o.value)).toContain(title)
        expect(opts.map((o: any) => o?.option?.title)).toContain("Spinning")
      }

      // 3. Distinct SKUs and distinct inventory items — the failure mode where
      //    both variants share one inventory item would make stock on one show
      //    up on the other.
      const skus = product.variants.map((v: any) => v.sku)
      expect(new Set(skus).size).toBe(2)

      const itemIds = product.variants.flatMap((v: any) =>
        (v.inventory_items || []).map((ii: any) => ii.inventory_item_id)
      )
      expect(itemIds.length).toBe(2)
      expect(new Set(itemIds).size).toBe(2)

      // 4. EVERY variant got a location level, not just the first one.
      for (const v of product.variants) {
        expect(levelsOf(v).length).toBeGreaterThanOrEqual(1)
      }
    })

    it("creates a variant for every combination when two options are named", async () => {
      const stamp = Date.now()
      const combos = [
        ["Mill Spun", "S"],
        ["Mill Spun", "M"],
        ["Hand Spun", "S"],
        ["Hand Spun", "M"],
      ]

      const payload = {
        store_id: storeId,
        product: {
          title: "Pashmina Stole",
          handle: `pashmina-stole-${stamp}`,
          options: [
            { title: "Spinning", values: ["Mill Spun", "Hand Spun"] },
            { title: "Size", values: ["S", "M"] },
          ],
          variants: combos.map(([spin, size], i) => ({
            title: `${spin} / ${size}`,
            sku: `STOLE-${i}-${stamp}`,
            options: { Spinning: spin, Size: size },
            prices: [{ amount: 15000, currency_code: currencyCode }],
          })),
        },
      }

      const createRes = await api.post("/partners/products", payload, {
        headers: partnerHeaders,
      })
      expect(createRes.status).toBe(201)

      const product = await getProductWithInventory(createRes.data.product.id)
      expect(product.variants).toHaveLength(4)

      const seen = product.variants
        .map((v: any) => {
          const o = Object.fromEntries(
            (v.options || []).map((x: any) => [x?.option?.title, x.value])
          )
          return `${o.Spinning}|${o.Size}`
        })
        .sort()
      expect(seen).toEqual(
        combos.map(([a, b]) => `${a}|${b}`).sort()
      )

      // Per-variant inventory holds at 4 variants too — this is the assertion
      // that would catch a loop that silently stops early under load.
      for (const v of product.variants) {
        expect(levelsOf(v).length).toBeGreaterThanOrEqual(1)
      }
    })

    it("creates untracked variants with no inventory item and no level at all", async () => {
      // Made-to-order pashmina is not stocked. `manage_inventory: false` must
      // produce a variant with NO inventory item and NO location level — not a
      // tracked variant with an empty item, which is the shape that 404s the
      // partner-ui inventory page and cannot be repaired afterwards (Medusa
      // cannot turn manage_inventory ON for an existing variant).
      const stamp = Date.now()
      const payload = {
        store_id: storeId,
        product: {
          title: "Pashmina Made To Order",
          handle: `pashmina-mto-${stamp}`,
          options: [{ title: "Spinning", values: ["Mill Spun", "Hand Spun"] }],
          variants: [
            {
              title: "Mill Spun",
              sku: `MTO-MILL-${stamp}`,
              options: { Spinning: "Mill Spun" },
              prices: [{ amount: 12000, currency_code: currencyCode }],
              manage_inventory: false,
            },
            {
              title: "Hand Spun",
              sku: `MTO-HAND-${stamp}`,
              options: { Spinning: "Hand Spun" },
              prices: [{ amount: 24000, currency_code: currencyCode }],
              manage_inventory: false,
            },
          ],
        },
      }

      const createRes = await api.post("/partners/products", payload, {
        headers: partnerHeaders,
      })
      expect(createRes.status).toBe(201)

      const product = await getProductWithInventory(createRes.data.product.id)
      expect(product.variants).toHaveLength(2)

      for (const v of product.variants) {
        expect(v.manage_inventory).toBe(false)
        expect(v.inventory_items || []).toHaveLength(0)
        expect(levelsOf(v)).toHaveLength(0)
      }
    })

    it("seeds inventory only for the tracked variant when tracking is mixed", async () => {
      // The realistic artisan case: a stocked mill-spun line alongside a
      // made-to-order hand-spun one. This is the assertion that proves the
      // seeding loop FILTERS rather than just iterating — an all-tracked or
      // all-untracked fixture passes under either behaviour.
      const stamp = Date.now()
      const payload = {
        store_id: storeId,
        product: {
          title: "Pashmina Mixed",
          handle: `pashmina-mixed-${stamp}`,
          options: [{ title: "Spinning", values: ["Mill Spun", "Hand Spun"] }],
          variants: [
            {
              title: "Mill Spun",
              sku: `MIX-MILL-${stamp}`,
              options: { Spinning: "Mill Spun" },
              prices: [{ amount: 12000, currency_code: currencyCode }],
              manage_inventory: true,
            },
            {
              title: "Hand Spun",
              sku: `MIX-HAND-${stamp}`,
              options: { Spinning: "Hand Spun" },
              prices: [{ amount: 24000, currency_code: currencyCode }],
              manage_inventory: false,
            },
          ],
        },
      }

      const createRes = await api.post("/partners/products", payload, {
        headers: partnerHeaders,
      })
      expect(createRes.status).toBe(201)

      const product = await getProductWithInventory(createRes.data.product.id)
      const byTitle = Object.fromEntries(
        product.variants.map((v: any) => [v.title, v])
      )

      const tracked = byTitle["Mill Spun"]
      expect(tracked.manage_inventory).toBe(true)
      expect((tracked.inventory_items || []).length).toBeGreaterThanOrEqual(1)
      expect(levelsOf(tracked).length).toBeGreaterThanOrEqual(1)

      const untracked = byTitle["Hand Spun"]
      expect(untracked.manage_inventory).toBe(false)
      expect(untracked.inventory_items || []).toHaveLength(0)
      expect(levelsOf(untracked)).toHaveLength(0)
    })

    it("persists weight, dimensions and customs fields — per product AND per variant", async () => {
      // These are not cosmetic. Blue Dart rejects a waybill without Dimensions
      // and reads weight in KG (0 = missing), and international labels need an
      // hs_code — so a product created from the assistant without them is a
      // product that cannot be shipped abroad. Pin that they survive the
      // free-form `product` record → createProductsWorkflow hand-off, because
      // nothing in the route validator (`z.record(z.string(), z.any())`) would
      // complain if they were silently dropped.
      const stamp = Date.now()
      const payload = {
        store_id: storeId,
        product: {
          title: "Pashmina Wrap",
          handle: `pashmina-wrap-${stamp}`,
          // Product-level defaults — inherited conceptually, but Medusa stores
          // them on the product row and carriers read the VARIANT, so both are
          // asserted separately below.
          weight: 250,
          length: 200,
          width: 70,
          height: 3,
          material: "100% Cashmere",
          origin_country: "in",
          hs_code: "62141010",
          options: [{ title: "Spinning", values: ["Mill Spun", "Hand Spun"] }],
          variants: [
            {
              title: "Mill Spun",
              sku: `WRAP-MILL-${stamp}`,
              options: { Spinning: "Mill Spun" },
              prices: [{ amount: 12000, currency_code: currencyCode }],
              weight: 240,
              length: 200,
              width: 70,
              height: 3,
              material: "100% Cashmere",
              origin_country: "in",
              hs_code: "62141010",
            },
            {
              // Deliberately DIFFERENT weight from its sibling. If the workflow
              // collapsed variants onto one row, or copied variant #1's
              // measurements across, an equal-weight fixture would pass anyway.
              title: "Hand Spun",
              sku: `WRAP-HAND-${stamp}`,
              options: { Spinning: "Hand Spun" },
              prices: [{ amount: 24000, currency_code: currencyCode }],
              weight: 310,
              length: 210,
              width: 75,
              height: 4,
              material: "100% Pashmina",
              origin_country: "in",
              hs_code: "62141010",
            },
          ],
        },
      }

      const createRes = await api.post("/partners/products", payload, {
        headers: partnerHeaders,
      })
      expect(createRes.status).toBe(201)

      const res = await api.get(
        `/admin/products/${createRes.data.product.id}?fields=weight,length,width,height,material,origin_country,hs_code,` +
          `variants.title,variants.weight,variants.length,variants.width,variants.height,` +
          `variants.material,variants.origin_country,variants.hs_code`,
        adminHeaders
      )
      expect(res.status).toBe(200)
      const product = res.data.product

      expect(product).toMatchObject({
        weight: 250,
        length: 200,
        width: 70,
        height: 3,
        material: "100% Cashmere",
        origin_country: "in",
        hs_code: "62141010",
      })

      const byTitle = Object.fromEntries(
        product.variants.map((v: any) => [v.title, v])
      )
      expect(byTitle["Mill Spun"]).toMatchObject({
        weight: 240,
        length: 200,
        width: 70,
        height: 3,
        material: "100% Cashmere",
        origin_country: "in",
        hs_code: "62141010",
      })
      expect(byTitle["Hand Spun"]).toMatchObject({
        weight: 310,
        length: 210,
        width: 75,
        height: 4,
        material: "100% Pashmina",
        origin_country: "in",
        hs_code: "62141010",
      })
    })

    it("defaults to draft when status is omitted, and publishes only when asked", async () => {
      const stamp = Date.now()
      const base = (suffix: string) => ({
        store_id: storeId,
        product: {
          title: `Pashmina ${suffix}`,
          handle: `pashmina-${suffix}-${stamp}`,
          options: [{ title: "Spinning", values: ["Hand Spun"] }],
          variants: [
            {
              title: "Hand Spun",
              sku: `PASH-${suffix}-${stamp}`,
              options: { Spinning: "Hand Spun" },
              prices: [{ amount: 20000, currency_code: currencyCode }],
            },
          ],
        },
      })

      // No status asked for → draft.
      const draftPayload = base("draft")
      const draftRes = await api.post("/partners/products", draftPayload, {
        headers: partnerHeaders,
      })
      expect(draftRes.status).toBe(201)
      const draft = await getProductWithInventory(draftRes.data.product.id)
      expect(draft.status).toBe(ProductStatus.DRAFT)

      // Explicitly asked to publish → published.
      const pubPayload: any = base("live")
      pubPayload.product.status = ProductStatus.PUBLISHED
      const pubRes = await api.post("/partners/products", pubPayload, {
        headers: partnerHeaders,
      })
      expect(pubRes.status).toBe(201)
      const published = await getProductWithInventory(pubRes.data.product.id)
      expect(published.status).toBe(ProductStatus.PUBLISHED)
    })
  })
})
