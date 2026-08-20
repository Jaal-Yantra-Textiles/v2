import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { PARTNER_ONBOARDING_PROFILE_MODULE } from "../../src/modules/partner-onboarding-profile"

/**
 * #1380 / #1370 — `create-partner-product`, the single workflow behind BOTH
 * partner product-create routes.
 *
 * Two things need proving, and they pull in opposite directions:
 *
 *  1. The legacy `POST /partners/products` is the only create path with request
 *     validation, and it is what the assistant's `create_product` tool and every
 *     third-party MCP client post to. Its envelope, its response shape and its
 *     validator are a contract. Migrating it onto the shared workflow must not
 *     move any of them.
 *
 *  2. The `when()` gate that skips `ensureInventoryLevelsForVariants` has to be
 *     right in BOTH directions. Measured on prod, that phase was 70% and 93% of
 *     the two create requests while doing nothing at all on unmanaged payloads —
 *     but skipping it when a variant IS managed silently reintroduces the 404 on
 *     the partner inventory page that the helper exists to prevent. So the tests
 *     below assert the skip is safe AND that the branch still fires.
 */

const TEST_PARTNER_PASSWORD = "supersecret"

jest.setTimeout(90 * 1000)

async function createPartnerWithStore(api: any, adminHeaders: Record<string, any>) {
  const unique = Date.now() + Math.random().toString(36).slice(2, 6)
  const email = `partner-cpw-${unique}@medusa-test.com`

  await api.post("/auth/partner/emailpass/register", {
    email,
    password: TEST_PARTNER_PASSWORD,
  })
  const login1 = await api.post("/auth/partner/emailpass", {
    email,
    password: TEST_PARTNER_PASSWORD,
  })
  let headers: Record<string, string> = {
    Authorization: `Bearer ${login1.data.token}`,
  }

  const partnerRes = await api.post(
    "/partners",
    {
      name: `CPWTest ${unique}`,
      handle: `cpwtest-${unique}`,
      admin: { email, first_name: "Admin", last_name: "CPW" },
    },
    { headers }
  )
  const partnerId = partnerRes.data.partner.id

  // Re-login so the token carries the partner association.
  const login2 = await api.post("/auth/partner/emailpass", {
    email,
    password: TEST_PARTNER_PASSWORD,
  })
  headers = { Authorization: `Bearer ${login2.data.token}` }

  const currenciesRes = await api.get("/admin/currencies", adminHeaders)
  const currencies = currenciesRes.data.currencies || []
  const usd = currencies.find((c: any) => c.code?.toLowerCase() === "usd")
  const currencyCode = String((usd || currencies[0]).code).toLowerCase()

  const storeRes = await api.post(
    "/partners/stores",
    {
      store: {
        name: `CPWStore ${unique}`,
        supported_currencies: [{ currency_code: currencyCode, is_default: true }],
      },
      sales_channel: { name: `CPWChannel ${unique}`, description: "Default" },
      region: { name: "Default Region", currency_code: currencyCode, countries: ["us"] },
      location: {
        name: "Warehouse",
        address: {
          address_1: "1 Main St",
          city: "NY",
          postal_code: "10001",
          country_code: "US",
        },
      },
    },
    { headers }
  )

  return {
    headers,
    partnerId,
    unique,
    currencyCode,
    storeId: storeRes.data.store.id,
    salesChannelId: storeRes.data.sales_channel?.id,
    locationId: storeRes.data.location?.id,
  }
}

/** A product payload whose variants are explicitly NOT inventory-managed. */
const unmanagedProduct = (unique: string | number, currencyCode: string) => ({
  title: `CPW Unmanaged ${unique}`,
  handle: `cpw-unmanaged-${unique}`,
  status: "draft",
  options: [{ title: "Spin Type", values: ["Hand Spun", "Mill Spun"] }],
  variants: [
    {
      title: "Hand Spun",
      sku: `CPW-U-HS-${unique}`,
      manage_inventory: false,
      options: { "Spin Type": "Hand Spun" },
      prices: [{ amount: 2200, currency_code: currencyCode }],
    },
    {
      title: "Mill Spun",
      sku: `CPW-U-MS-${unique}`,
      manage_inventory: false,
      options: { "Spin Type": "Mill Spun" },
      prices: [{ amount: 1600, currency_code: currencyCode }],
    },
  ],
})

/** Same shape, but inventory-managed — the branch must fire for this one. */
const managedProduct = (unique: string | number, currencyCode: string) => ({
  title: `CPW Managed ${unique}`,
  handle: `cpw-managed-${unique}`,
  status: "draft",
  options: [{ title: "Spin Type", values: ["Hand Spun"] }],
  variants: [
    {
      title: "Hand Spun",
      sku: `CPW-M-HS-${unique}`,
      manage_inventory: true,
      options: { "Spin Type": "Hand Spun" },
      prices: [{ amount: 2200, currency_code: currencyCode }],
    },
  ],
})

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Partner product create — shared workflow (#1380)", () => {
    let adminHeaders: Record<string, any>
    let partner: Awaited<ReturnType<typeof createPartnerWithStore>>

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)
      partner = await createPartnerWithStore(api, adminHeaders)
    })

    describe("legacy POST /partners/products — contract is unchanged", () => {
      it("keeps the { message, partner_id, store_id, product } response shape", async () => {
        const res = await api.post(
          "/partners/products",
          {
            store_id: partner.storeId,
            product: unmanagedProduct(partner.unique, partner.currencyCode),
          },
          { headers: partner.headers }
        )

        expect(res.status).toBe(201)
        // Every field here is wire-visible to MCP clients.
        expect(res.data.message).toBe("Product created")
        expect(res.data.partner_id).toBe(partner.partnerId)
        expect(res.data.store_id).toBe(partner.storeId)
        expect(res.data.product?.id).toBeDefined()
        expect(res.data.product?.variants).toHaveLength(2)
      })

      it("still returns the created variants that the MCP transform reads", async () => {
        // `create_product`'s transform walks product.variants[].manage_inventory
        // and .inventory_items to build its stock advisory. If the workflow ever
        // stopped returning expanded variants, the tool would quietly stop warning.
        const res = await api.post(
          "/partners/products",
          {
            store_id: partner.storeId,
            product: managedProduct(partner.unique, partner.currencyCode),
          },
          { headers: partner.headers }
        )

        expect(res.status).toBe(201)
        const variants = res.data.product?.variants || []
        expect(variants.length).toBeGreaterThan(0)
        expect(variants[0]).toHaveProperty("manage_inventory")
      })

      it("still rejects an unknown top-level key (the .strict() validator)", async () => {
        const res = await api
          .post(
            "/partners/products",
            {
              store_id: partner.storeId,
              product: unmanagedProduct(partner.unique, partner.currencyCode),
              not_a_real_field: true,
            },
            { headers: partner.headers }
          )
          .catch((e: any) => e.response)

        expect(res.status).toBe(400)
      })

      it("still rejects a missing store_id", async () => {
        const res = await api
          .post(
            "/partners/products",
            { product: unmanagedProduct(partner.unique, partner.currencyCode) },
            { headers: partner.headers }
          )
          .catch((e: any) => e.response)

        expect(res.status).toBe(400)
      })
    })

    describe("legacy POST /partners/products — store ownership is now enforced", () => {
      it("refuses to create in a store belonging to another partner", async () => {
        // Before the migration this route resolved the store by id alone, so
        // ANY authenticated partner could create a product in ANY store.
        const other = await createPartnerWithStore(api, adminHeaders)

        const res = await api
          .post(
            "/partners/products",
            {
              store_id: partner.storeId,
              product: unmanagedProduct(other.unique, other.currencyCode),
            },
            { headers: other.headers }
          )
          .catch((e: any) => e.response)

        expect(res.status).toBe(401)
      })
    })

    describe("scoped POST /partners/stores/:id/products — contract is unchanged", () => {
      it("returns a bare { product } body, not the legacy envelope", async () => {
        const res = await api.post(
          `/partners/stores/${partner.storeId}/products`,
          unmanagedProduct(partner.unique, partner.currencyCode),
          { headers: partner.headers }
        )

        expect(res.status).toBe(201)
        expect(res.data.product?.id).toBeDefined()
        expect(res.data.message).toBeUndefined()
        expect(res.data.partner_id).toBeUndefined()
      })
    })

    describe("the inventory-level branch", () => {
      it("skips seeding when no variant manages inventory — and there is nothing to seed", async () => {
        const res = await api.post(
          `/partners/stores/${partner.storeId}/products`,
          unmanagedProduct(partner.unique, partner.currencyCode),
          { headers: partner.headers }
        )
        expect(res.status).toBe(201)

        // The gate is only safe because an unmanaged variant has no inventory
        // item to hold a level in the first place. Assert that precondition
        // rather than the absence of the work, so the test fails loudly if
        // Medusa ever starts creating items for unmanaged variants.
        const productId = res.data.product.id
        const detail = await api.get(
          `/partners/stores/${partner.storeId}/products/${productId}`,
          { headers: partner.headers }
        )
        expect(detail.status).toBe(200)

        for (const v of detail.data.product?.variants || []) {
          expect(v.manage_inventory).toBe(false)
          expect(v.inventory_items || []).toHaveLength(0)
        }
      })

      it("still seeds a stock level when a variant DOES manage inventory (scoped route)", async () => {
        const res = await api.post(
          `/partners/stores/${partner.storeId}/products`,
          managedProduct(partner.unique, partner.currencyCode),
          { headers: partner.headers }
        )
        expect(res.status).toBe(201)

        const productId = res.data.product.id
        const detail = await api.get(
          `/partners/stores/${partner.storeId}/products/${productId}`,
          { headers: partner.headers }
        )
        const variant = (detail.data.product?.variants || [])[0]
        const inventoryItemId =
          variant?.inventory_items?.[0]?.inventory?.id ??
          variant?.inventory_items?.[0]?.inventory_item_id
        expect(inventoryItemId).toBeDefined()

        // The 404 repro: without a level this route fails. A level proves the
        // `when(hasManagedVariants)` branch actually ran.
        const inventoryRes = await api.get(
          `/partners/inventory-items/${inventoryItemId}`,
          { headers: partner.headers }
        )
        expect(inventoryRes.status).toBe(200)
        expect(
          inventoryRes.data.inventory_item?.location_levels?.length
        ).toBeGreaterThan(0)
      })

      it("still seeds a stock level when a variant DOES manage inventory (legacy route)", async () => {
        // The same branch, reached through the other route. This is the pairing
        // that did not exist before: one workflow, both callers.
        const res = await api.post(
          "/partners/products",
          {
            store_id: partner.storeId,
            product: managedProduct(partner.unique, partner.currencyCode),
          },
          { headers: partner.headers }
        )
        expect(res.status).toBe(201)

        const productId = res.data.product.id
        const detail = await api.get(
          `/partners/stores/${partner.storeId}/products/${productId}`,
          { headers: partner.headers }
        )
        const variant = (detail.data.product?.variants || [])[0]
        const inventoryItemId =
          variant?.inventory_items?.[0]?.inventory?.id ??
          variant?.inventory_items?.[0]?.inventory_item_id
        expect(inventoryItemId).toBeDefined()

        const inventoryRes = await api.get(
          `/partners/inventory-items/${inventoryItemId}`,
          { headers: partner.headers }
        )
        expect(inventoryRes.status).toBe(200)
        expect(
          inventoryRes.data.inventory_item?.location_levels?.length
        ).toBeGreaterThan(0)
      })
    })

    describe("#1380 step 1 — the previously unvalidated routes", () => {
      it("scoped create now rejects a body with no title", async () => {
        const { title, ...noTitle } = unmanagedProduct(
          partner.unique,
          partner.currencyCode
        )
        const res = await api
          .post(`/partners/stores/${partner.storeId}/products`, noTitle, {
            headers: partner.headers,
          })
          .catch((e: any) => e.response)

        expect(res.status).toBe(400)
      })

      it("scoped create still accepts arbitrary product fields", async () => {
        // The body IS the product, so its top level has to stay open. This is
        // the assertion that would catch `.passthrough()` being silently
        // overridden by the framework's forced `.strict()`.
        const res = await api.post(
          `/partners/stores/${partner.storeId}/products`,
          {
            ...unmanagedProduct(partner.unique, partner.currencyCode),
            subtitle: "an unlisted but perfectly valid product field",
            metadata: { source: "cpw-test" },
          },
          { headers: partner.headers }
        )

        expect(res.status).toBe(201)
        expect(res.data.product?.subtitle).toBe(
          "an unlisted but perfectly valid product field"
        )
      })

      it("quick create rejects a misspelled stock field instead of ignoring it", async () => {
        // Quick-create's payload is closed, so `.strict()` is what we want:
        // a typo'd `stock` used to create a product with no stock, silently.
        const res = await api
          .post(
            `/partners/stores/${partner.storeId}/products/quick`,
            { title: `CPW Quick ${partner.unique}`, price: 1500, stock: 7 },
            { headers: partner.headers }
          )
          .catch((e: any) => e.response)

        expect(res.status).toBe(400)
      })

      it("quick create rejects a negative price", async () => {
        const res = await api
          .post(
            `/partners/stores/${partner.storeId}/products/quick`,
            { title: `CPW Quick ${partner.unique}`, price: -1 },
            { headers: partner.headers }
          )
          .catch((e: any) => e.response)

        expect(res.status).toBe(400)
      })
    })

    describe("quick create — the stock-level gap it always had", () => {
      it("seeds a level even when no stock_quantity is passed", async () => {
        // Quick-create's variant is ALWAYS manage_inventory: true, but its own
        // seeding only ran when a quantity was supplied. Omit the quantity and
        // the partner inventory page used to 404 on the item.
        const res = await api.post(
          `/partners/stores/${partner.storeId}/products/quick`,
          { title: `CPW QuickNoStock ${partner.unique}`, price: 1500 },
          { headers: partner.headers }
        )
        expect(res.status).toBe(201)

        const productId = res.data.product.id
        const detail = await api.get(
          `/partners/stores/${partner.storeId}/products/${productId}`,
          { headers: partner.headers }
        )
        const variant = (detail.data.product?.variants || [])[0]
        const inventoryItemId =
          variant?.inventory_items?.[0]?.inventory?.id ??
          variant?.inventory_items?.[0]?.inventory_item_id
        expect(inventoryItemId).toBeDefined()

        const inventoryRes = await api.get(
          `/partners/inventory-items/${inventoryItemId}`,
          { headers: partner.headers }
        )
        expect(inventoryRes.status).toBe(200)
        expect(
          inventoryRes.data.inventory_item?.location_levels?.length
        ).toBeGreaterThan(0)
      })

      it("still writes the requested quantity when one IS passed", async () => {
        // The ordering guard: the shared workflow must NOT seed a 0-qty level
        // ahead of this route's real write, or they collide on the same pair.
        const res = await api.post(
          `/partners/stores/${partner.storeId}/products/quick`,
          {
            title: `CPW QuickStock ${partner.unique}`,
            price: 1500,
            stock_quantity: 42,
          },
          { headers: partner.headers }
        )
        expect(res.status).toBe(201)

        const productId = res.data.product.id
        const detail = await api.get(
          `/partners/stores/${partner.storeId}/products/${productId}`,
          { headers: partner.headers }
        )
        const variant = (detail.data.product?.variants || [])[0]
        const inventoryItemId =
          variant?.inventory_items?.[0]?.inventory?.id ??
          variant?.inventory_items?.[0]?.inventory_item_id

        const inventoryRes = await api.get(
          `/partners/inventory-items/${inventoryItemId}`,
          { headers: partner.headers }
        )
        const levels = inventoryRes.data.inventory_item?.location_levels || []
        const total = levels.reduce(
          (sum: number, l: any) => sum + (Number(l.stocked_quantity) || 0),
          0
        )
        expect(total).toBe(42)
      })
    })

    describe("admin create-on-behalf — same workflow, gate deliberately OFF", () => {
      it("creates in the partner's store and reports the attribution", async () => {
        const res = await api.post(
          `/admin/stores/${partner.storeId}/products`,
          unmanagedProduct(`adm-${partner.unique}`, partner.currencyCode),
          adminHeaders
        )

        expect(res.status).toBe(201)
        expect(res.data.product?.id).toBeDefined()
        expect(res.data.partner_id).toBe(partner.partnerId)
        expect(res.data.store_id).toBe(partner.storeId)
        expect(res.data.created_on_behalf).toBe(true)
      })

      it("seeds stock levels for a managed variant", async () => {
        const res = await api.post(
          `/admin/stores/${partner.storeId}/products`,
          managedProduct(`adm-${partner.unique}`, partner.currencyCode),
          adminHeaders
        )
        expect(res.status).toBe(201)

        const detail = await api.get(
          `/partners/stores/${partner.storeId}/products/${res.data.product.id}`,
          { headers: partner.headers }
        )
        const variant = (detail.data.product?.variants || [])[0]
        const inventoryItemId =
          variant?.inventory_items?.[0]?.inventory?.id ??
          variant?.inventory_items?.[0]?.inventory_item_id

        const inventoryRes = await api.get(
          `/partners/inventory-items/${inventoryItemId}`,
          { headers: partner.headers }
        )
        expect(inventoryRes.status).toBe(200)
        expect(
          inventoryRes.data.inventory_item?.location_levels?.length
        ).toBeGreaterThan(0)
      })

      it("does NOT force an artisan's product into the proposal queue", async () => {
        // The partner-facing routes override status to `proposed` for a
        // core_channel_listing partner. This route never has, and an admin
        // creating on their behalf IS the approval — so the gate stays off.
        const container = getContainer()
        const onboarding: any = container.resolve(
          PARTNER_ONBOARDING_PROFILE_MODULE
        )
        await onboarding.createPartnerOnboardingProfiles({
          partner_id: partner.partnerId,
          selling_mode: "core_channel_listing",
        })

        const viaAdmin = await api.post(
          `/admin/stores/${partner.storeId}/products`,
          unmanagedProduct(`adm-gate-${partner.unique}`, partner.currencyCode),
          adminHeaders
        )
        expect(viaAdmin.status).toBe(201)
        expect(viaAdmin.data.product?.status).toBe("draft")

        // Control: the SAME partner through the partner route IS gated, which
        // is what proves the assertion above is about the route and not about
        // the profile failing to seed.
        const viaPartner = await api.post(
          "/partners/products",
          {
            store_id: partner.storeId,
            product: unmanagedProduct(
              `p-gate-${partner.unique}`,
              partner.currencyCode
            ),
          },
          { headers: partner.headers }
        )
        expect(viaPartner.status).toBe(201)
        expect(viaPartner.data.message).toBe("Product proposed")
        expect(viaPartner.data.product?.status).toBe("proposed")
      })
    })

    describe("variants/batch — same workflow discipline (#1380)", () => {
      it("updates prices and returns the enriched variants", async () => {
        const created = await api.post(
          `/partners/stores/${partner.storeId}/products`,
          unmanagedProduct(`batch-${partner.unique}`, partner.currencyCode),
          { headers: partner.headers }
        )
        const productId = created.data.product.id
        const variant = created.data.product.variants[0]

        const res = await api.post(
          `/partners/stores/${partner.storeId}/products/${productId}/variants/batch`,
          {
            update: [
              {
                id: variant.id,
                prices: [{ amount: 9999, currency_code: partner.currencyCode }],
              },
            ],
          },
          { headers: partner.headers }
        )

        expect(res.status).toBe(200)
        expect(res.data.updated).toHaveLength(1)
        expect(res.data.updated[0].id).toBe(variant.id)
        // The enrichment must still produce `prices` — `remapVariantResponse`
        // builds them from `price_set.prices`, and if that field spelling ever
        // drifts the response goes quietly price-less and the FX fanout has
        // nothing to fan out.
        const amounts = (res.data.updated[0].prices || []).map(
          (pr: any) => pr.amount
        )
        expect(amounts).toContain(9999)
      })

      it("honours ?fields= and still returns the ids the caller asked for", async () => {
        const created = await api.post(
          `/partners/stores/${partner.storeId}/products`,
          unmanagedProduct(`narrow-${partner.unique}`, partner.currencyCode),
          { headers: partner.headers }
        )
        const productId = created.data.product.id
        const variant = created.data.product.variants[0]

        const res = await api.post(
          `/partners/stores/${partner.storeId}/products/${productId}/variants/batch?fields=id`,
          {
            update: [
              {
                id: variant.id,
                prices: [{ amount: 7777, currency_code: partner.currencyCode }],
              },
            ],
          },
          { headers: partner.headers }
        )

        expect(res.status).toBe(200)
        expect(res.data.updated[0].id).toBe(variant.id)
        // The narrowing is real: the 20-odd scalars the default set carries
        // must NOT come back when the caller asked for `id`.
        expect(res.data.updated[0].sku).toBeUndefined()
        expect(res.data.updated[0].weight).toBeUndefined()
      })

      it("a narrowed request still carries the price ids the FX fanout needs", async () => {
        // `withPriceIds` enforces this server-side. If it ever regresses, the
        // fanout goes quiet with no error — prices stay in one currency and
        // read as "not available" everywhere else. The response is the only
        // place that invariant is observable from outside.
        const created = await api.post(
          `/partners/stores/${partner.storeId}/products`,
          unmanagedProduct(`fanout-${partner.unique}`, partner.currencyCode),
          { headers: partner.headers }
        )
        const productId = created.data.product.id
        const variant = created.data.product.variants[0]

        const res = await api.post(
          `/partners/stores/${partner.storeId}/products/${productId}/variants/batch?fields=id`,
          {
            update: [
              {
                id: variant.id,
                prices: [{ amount: 8888, currency_code: partner.currencyCode }],
              },
            ],
          },
          { headers: partner.headers }
        )

        expect(res.status).toBe(200)
        const prices = res.data.updated[0].prices || []
        expect(prices.length).toBeGreaterThan(0)
        expect(prices.every((pr: any) => typeof pr.id === "string")).toBe(true)
      })

      it("a delete-only batch skips the enrichment re-read entirely", async () => {
        // The re-read is the expensive phase on this route (15977ms of a
        // 16364ms request at its worst). A batch that only deletes has nothing
        // to re-read, and used to pay for the round trip anyway.
        const created = await api.post(
          `/partners/stores/${partner.storeId}/products`,
          unmanagedProduct(`del-${partner.unique}`, partner.currencyCode),
          { headers: partner.headers }
        )
        const productId = created.data.product.id
        const variantId = created.data.product.variants[1].id

        const res = await api.post(
          `/partners/stores/${partner.storeId}/products/${productId}/variants/batch`,
          { delete: [variantId] },
          { headers: partner.headers }
        )

        expect(res.status).toBe(200)
        expect(res.data.deleted?.ids).toContain(variantId)
        expect(res.data.deleted?.deleted).toBe(true)
        expect(res.data.created).toEqual([])
        expect(res.data.updated).toEqual([])

        // And the variant really is gone — a shape-only assertion here would
        // pass just as happily against a no-op.
        const detail = await api.get(
          `/partners/stores/${partner.storeId}/products/${productId}`,
          { headers: partner.headers }
        )
        const remaining = (detail.data.product?.variants || []).map(
          (v: any) => v.id
        )
        expect(remaining).not.toContain(variantId)
      })
    })

    describe("both routes produce the same product state", () => {
      it("attaches the store's default sales channel either way", async () => {
        const viaLegacy = await api.post(
          "/partners/products",
          {
            store_id: partner.storeId,
            product: unmanagedProduct(`l-${partner.unique}`, partner.currencyCode),
          },
          { headers: partner.headers }
        )
        const viaScoped = await api.post(
          `/partners/stores/${partner.storeId}/products`,
          unmanagedProduct(`s-${partner.unique}`, partner.currencyCode),
          { headers: partner.headers }
        )

        expect(viaLegacy.status).toBe(201)
        expect(viaScoped.status).toBe(201)

        for (const productId of [
          viaLegacy.data.product.id,
          viaScoped.data.product.id,
        ]) {
          const adminRes = await api.get(
            `/admin/products/${productId}?fields=id,status,*sales_channels`,
            adminHeaders
          )
          expect(adminRes.status).toBe(200)
          const channelIds = (adminRes.data.product?.sales_channels || []).map(
            (c: any) => c.id
          )
          expect(channelIds).toContain(partner.salesChannelId)
          expect(adminRes.data.product?.status).toBe("draft")
        }
      })
    })
  })
})
