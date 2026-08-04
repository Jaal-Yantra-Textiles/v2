import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import {
  createTestCustomer,
  getCustomerAuthHeaders,
  resetTestCustomerCredentials,
} from "../helpers/create-customer"

jest.setTimeout(90 * 1000)

/** Surfaces the response body on failure — 4xx bodies are otherwise swallowed. */
const loud = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn()
  } catch (e: any) {
    console.log(`[${label}] ${e.response?.status}`, JSON.stringify(e.response?.data))
    throw e
  }
}

/**
 * Reproduces the production condition that hides "Mark as shipped" on a
 * fulfillment (see the prod audit of v3.jaalyantra.com: 54/75 products carry no
 * shipping profile, and every recent fulfillment has `requires_shipping: false`
 * despite sitting on a manual_manual option in a `type: "shipping"` set).
 *
 * The dashboard gate is:
 *   showShippingButton = !canceled_at && !shipped_at && !delivered_at
 *                        && fulfillment.requires_shipping
 *                        && !isPickUpFulfillment
 *
 * Medusa derives the line item's flag in `prepareLineItemData`:
 *   requires_shipping = isDefined(item.requires_shipping)
 *     ? item.requires_shipping
 *     : hasShippingProfile || someInventoryRequiresShipping
 *
 * and `createOrderFulfillmentWorkflow` copies `someItemsRequireShipping` onto
 * the fulfillment. So a product with no shipping profile AND
 * `manage_inventory: false` (no inventory items to vote "true") yields a
 * fulfillment that the UI refuses to offer a shipment for — even though the
 * user guide says the only restriction is that the option isn't a pickup one.
 */
setupSharedTestSuite(() => {
  describe("requires_shipping → 'Mark as shipped' gate", () => {
    let adminHeaders: { headers: Record<string, string> }
    let customerHeaders: { headers: Record<string, string> }
    let regionId: string
    let salesChannelId: string
    let profileId: string

    beforeEach(async () => {
      const { api, getContainer } = getSharedTestEnv()
      const container = getContainer()

      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)

      resetTestCustomerCredentials()
      await createTestCustomer(container)
      customerHeaders = await getCustomerAuthHeaders()

      const regions = await api.get("/admin/regions?limit=1", adminHeaders)
      regionId =
        regions.data.regions?.[0]?.id ??
        (
          await api.post(
            "/admin/regions",
            { name: "Test Region", currency_code: "usd", countries: ["us"] },
            adminHeaders
          )
        ).data.region.id
      expect(regionId).toBeTruthy()

      const channels = await api.get("/admin/sales-channels?limit=1", adminHeaders)
      salesChannelId =
        channels.data.sales_channels?.[0]?.id ??
        (
          await api.post(
            "/admin/sales-channels",
            { name: "Test Channel" },
            adminHeaders
          )
        ).data.sales_channel.id
      expect(salesChannelId).toBeTruthy()

      const profiles = await api.get("/admin/shipping-profiles?limit=1", adminHeaders)
      profileId =
        profiles.data.shipping_profiles?.[0]?.id ??
        (
          await api.post(
            "/admin/shipping-profiles",
            { name: "Default", type: "default" },
            adminHeaders
          )
        ).data.shipping_profile.id
      expect(profileId).toBeTruthy()
    })

    /** Mirrors prod: manage_inventory false, shipping profile optional. */
    const createProduct = async (
      api: any,
      opts: { withProfile: boolean; label: string }
    ) => {
      const res = await api.post(
        "/admin/products",
        {
          title: `${opts.label} ${Date.now()}`,
          status: "published",
          options: [{ title: "Size", values: ["OS"] }],
          ...(opts.withProfile ? { shipping_profile_id: profileId } : {}),
          variants: [
            {
              title: "OS",
              sku: `RS-${opts.label}-${Date.now()}`,
              manage_inventory: false,
              options: { Size: "OS" },
              prices: [{ currency_code: "usd", amount: 1500 }],
            },
          ],
          sales_channels: [{ id: salesChannelId }],
        },
        adminHeaders
      )
      expect(res.status).toBe(200)
      const productId = res.data.product.id
      // The create response omits the profile link — re-read it explicitly.
      const detail = await api.get(
        `/admin/products/${productId}?fields=id,shipping_profile.id`,
        adminHeaders
      )
      return {
        productId,
        variantId: res.data.product.variants[0].id,
        shippingProfile: detail.data.product.shipping_profile ?? null,
      }
    }

    /** A manual shipping option on a `type: "shipping"` set — the prod shape. */
    const createManualShippingOption = async (api: any) => {
      const loc = await api.post(
        "/admin/stock-locations",
        {
          name: `Gate Warehouse ${Date.now()}`,
          address: {
            address_1: "1 Loom St",
            city: "Dallas",
            postal_code: "75201",
            country_code: "us",
          },
        },
        adminHeaders
      )
      const locationId = loc.data.stock_location.id

      // The location must enable the provider before options can use it.
      await loud("fulfillment-providers", () =>
        api.post(
          `/admin/stock-locations/${locationId}/fulfillment-providers`,
          { add: ["manual_manual"] },
          adminHeaders
        )
      )

      await api.post(
        `/admin/stock-locations/${locationId}/fulfillment-sets`,
        { name: `Gate Shipping ${Date.now()}`, type: "shipping" },
        adminHeaders
      )
      const locDetail = await api.get(
        `/admin/stock-locations/${locationId}?fields=id,*fulfillment_sets`,
        adminHeaders
      )
      const fulfillmentSet = (
        locDetail.data.stock_location.fulfillment_sets || []
      ).find((f: any) => f.type === "shipping")
      expect(fulfillmentSet).toBeTruthy()

      const zoneRes = await loud("service-zones", () =>
        api.post(
          `/admin/fulfillment-sets/${fulfillmentSet.id}/service-zones`,
          { name: "US Zone", geo_zones: [{ type: "country", country_code: "us" }] },
          adminHeaders
        )
      )
      const zoneId = zoneRes.data.fulfillment_set.service_zones[0].id

      const optRes = await loud("shipping-options", () =>
        api.post(
        "/admin/shipping-options",
        {
          name: "Standard Shipping",
          service_zone_id: zoneId,
          shipping_profile_id: profileId,
          provider_id: "manual_manual",
          price_type: "flat",
          type: { label: "Standard", description: "Std", code: "standard" },
          prices: [{ currency_code: "usd", amount: 10 }],
        },
        adminHeaders
        )
      )
      return optRes.data.shipping_option.id
    }

    const addToCart = async (api: any, variantId: string) => {
      const cart = await api.post(
        "/store/carts",
        { region_id: regionId, sales_channel_id: salesChannelId },
        customerHeaders
      )
      const cartId = cart.data.cart.id
      await api.post(
        `/store/carts/${cartId}/line-items`,
        { variant_id: variantId, quantity: 1 },
        customerHeaders
      )
      const after = await api.get(`/store/carts/${cartId}`, customerHeaders)
      return after.data.cart.items[0]
    }

    it("derives requires_shipping=false when the product has NO shipping profile", async () => {
      const { api } = getSharedTestEnv()
      const { variantId, shippingProfile } = await createProduct(api, {
        withProfile: false,
        label: "NoProfile",
      })
      expect(shippingProfile).toBeNull()

      const item = await addToCart(api, variantId)
      expect(item.requires_shipping).toBe(false)
    })

    it("derives requires_shipping=true when the product HAS a shipping profile", async () => {
      const { api } = getSharedTestEnv()
      const { variantId, shippingProfile } = await createProduct(api, {
        withProfile: true,
        label: "WithProfile",
      })
      expect(shippingProfile?.id).toBe(profileId)

      const item = await addToCart(api, variantId)
      expect(item.requires_shipping).toBe(true)
    })

    const fulfilOrderFor = async (api: any, variantId: string) => {
      // An order carrying only the item under test.
      const draft = await api.post(
        "/admin/draft-orders",
        {
          email: "gate@test.com",
          region_id: regionId,
          sales_channel_id: salesChannelId,
          currency_code: "usd",
          shipping_address: {
            first_name: "Gate",
            last_name: "Test",
            address_1: "1 Test Rd",
            city: "Dallas",
            province: "TX",
            postal_code: "75201",
            country_code: "us",
          },
          items: [{ variant_id: variantId, quantity: 1, unit_price: 1500 }],
        },
        adminHeaders
      )
      const converted = await api.post(
        `/admin/draft-orders/${draft.data.draft_order.id}/convert-to-order`,
        {},
        adminHeaders
      )
      const orderId = converted.data.order.id

      const order = await api.get(
        `/admin/orders/${orderId}?fields=id,items.id,items.requires_shipping`,
        adminHeaders
      )

      // Fulfil it against a manual option on a `type: "shipping"` set — the
      // exact prod shape, so the pickup rule is NOT what's in play.
      const shippingOptionId = await createManualShippingOption(api)

      const fulfilRes = await loud("fulfillments", () =>
        api.post(
          `/admin/orders/${orderId}/fulfillments`,
          {
            items: [{ id: order.data.order.items[0].id, quantity: 1 }],
            shipping_option_id: shippingOptionId,
          },
          adminHeaders
        )
      )
      expect(fulfilRes.status).toBe(200)

      const withFulfilments = await api.get(
        `/admin/orders/${orderId}?fields=id,fulfillments.id,fulfillments.requires_shipping,fulfillments.shipped_at,fulfillments.canceled_at,fulfillments.delivered_at,fulfillments.shipping_option.provider_id,fulfillments.shipping_option.service_zone.fulfillment_set.type`,
        adminHeaders
      )
      const fulfillment = withFulfilments.data.order.fulfillments[0]

      const isPickUpFulfillment =
        fulfillment.shipping_option?.service_zone?.fulfillment_set?.type ===
        "pickup"

      // The dashboard gate, evaluated exactly as the UI evaluates it.
      const showShippingButton =
        !fulfillment.canceled_at &&
        !fulfillment.shipped_at &&
        !fulfillment.delivered_at &&
        fulfillment.requires_shipping &&
        !isPickUpFulfillment

      return {
        orderId,
        lineItemId: order.data.order.items[0].id,
        lineItemRequiresShipping:
          order.data.order.items[0].requires_shipping,
        fulfillment,
        isPickUpFulfillment,
        showShippingButton,
      }
    }

    it("hides the shipment action on a non-pickup manual option when the product has no shipping profile", async () => {
      const { api } = getSharedTestEnv()
      const { variantId } = await createProduct(api, {
        withProfile: false,
        label: "Fulfil",
      })

      const res = await fulfilOrderFor(api, variantId)

      expect(res.lineItemRequiresShipping).toBe(false)
      // The pickup rule the user guide documents does NOT apply here...
      expect(res.isPickUpFulfillment).toBe(false)
      // ...yet the fulfillment is still stamped false, and the dashboard hides
      // the shipment action purely on that undocumented term.
      expect(res.fulfillment.requires_shipping).toBe(false)
      expect(res.showShippingButton).toBe(false)
    })

    /**
     * Second, independent defect. The cart path honours the shipping profile
     * (see the test above), but the draft-order path does NOT: the item comes
     * out `requires_shipping: false` even when the product carries a profile.
     *
     * Isolated to `createOrderWorkflow` itself (not the draft-order route):
     * calling the workflow directly with a profiled variant yields `false`.
     * Ruled out along the way —
     *  - `query.graph` with the workflow's EXACT `variantFields` list returns
     *    `product.shipping_profile` fine, cached and uncached;
     *  - the variant IS resolved during line prep (item gets `product_id`);
     *  - only one `@medusajs/core-flows` copy is installed (2.17.2), and its
     *    `prepare-line-item-data.js:23-29` reads
     *    `variant?.product?.shipping_profile?.id` as expected.
     * So the profile is lost between the query step and `prepareLineItemData`
     * — most likely workflow step-output serialisation dropping the nested
     * link relation. That last hop is NOT proven.
     *
     * It no longer blocks us: an explicit `requires_shipping` on the item wins
     * over the derivation (`isDefined(item.requires_shipping) ? ... : ...`),
     * which is the lever the fix uses — see the test below.
     *
     * Asserted against the WORKFLOW, not the draft-order route: the route now
     * emits `order.placed`, whose subscriber repairs exactly this case, so
     * going through it would test our repair rather than the upstream defect.
     * If a Medusa upgrade fixes the derivation this test fails loudly — that
     * failure is GOOD NEWS, not a regression.
     */
    it("KNOWN DEFECT: createOrderWorkflow ignores the shipping profile", async () => {
      const { api, getContainer } = getSharedTestEnv()
      const { createOrderWorkflow } = await import("@medusajs/medusa/core-flows")
      const { variantId, shippingProfile } = await createProduct(api, {
        withProfile: true,
        label: "FulfilOk",
      })
      expect(shippingProfile?.id).toBe(profileId)

      const { result } = await createOrderWorkflow(getContainer()).run({
        input: {
          email: "known-defect@test.com",
          region_id: regionId,
          sales_channel_id: salesChannelId,
          currency_code: "usd",
          shipping_address: {
            first_name: "Known", last_name: "Defect", address_1: "1 Test Rd",
            city: "Dallas", province: "TX", postal_code: "75201", country_code: "us",
          },
          // No explicit flag — the derivation decides, and gets it wrong.
          items: [{ variant_id: variantId, quantity: 1, unit_price: 1500 }],
        } as any,
      })

      // Same product that yields `true` through the cart yields `false` here.
      expect((result as any).items[0].requires_shipping).toBe(false)
    })

    /**
     * The fix lever. `prepareLineItemData` honours an explicit flag ahead of the
     * broken derivation, so our own order-creating code (design orders, draft
     * orders, partner flows) can set it rather than wait on upstream. This is
     * the exact inverse of the two hard-coded `requires_shipping: false` lines
     * in create-draft-order-from-designs.ts:306 and designs/[id]/checkout.
     */
    it("honours an explicit requires_shipping on the item, overriding the derivation", async () => {
      const { api, getContainer } = getSharedTestEnv()
      const { createOrderWorkflow } = await import("@medusajs/medusa/core-flows")
      const { variantId } = await createProduct(api, {
        withProfile: false,
        label: "Explicit",
      })

      const { result } = await createOrderWorkflow(getContainer()).run({
        input: {
          email: "explicit@test.com",
          region_id: regionId,
          sales_channel_id: salesChannelId,
          currency_code: "usd",
          shipping_address: {
            first_name: "Ex", last_name: "Plicit", address_1: "1 Test Rd",
            city: "Dallas", province: "TX", postal_code: "75201", country_code: "us",
          },
          // No shipping profile on the product — the derivation would say false.
          items: [
            { variant_id: variantId, quantity: 1, unit_price: 1500, requires_shipping: true },
          ],
        } as any,
      })

      expect((result as any).items[0].requires_shipping).toBe(true)
    })

    /**
     * The forward fix (#1195 item 3). `order.placed` repairs the derived flag
     * on the ORDER, so newly placed orders never reach a fulfillment with the
     * wrong value and the DP backfill below is only ever needed for history.
     *
     * Scoped to products that HAVE a shipping profile — which is exactly the
     * draft-order defect (profile present, derivation still says false). Two
     * interlocks make a wider fix actively harmful, both verified here:
     *  - on the CART, `validateShippingStep` demands a shipping method whose
     *    profile matches the item's — unsatisfiable for our variant-less
     *    design items;
     *  - at FULFILLMENT, `create-fulfillment.js:78-83` throws when a
     *    requires-shipping item's product profile differs from the chosen
     *    option's, which for a profile-less product is always. See the test
     *    below.
     */
    it("order.placed repairs requires_shipping so new fulfillments come out true", async () => {
      const { api } = getSharedTestEnv()
      const { variantId } = await createProduct(api, {
        withProfile: true,
        label: "Forward",
      })

      const draft = await api.post(
        "/admin/draft-orders",
        {
          email: "forward@test.com",
          region_id: regionId,
          sales_channel_id: salesChannelId,
          currency_code: "usd",
          shipping_address: {
            first_name: "For", last_name: "Ward", address_1: "1 Test Rd",
            city: "Dallas", province: "TX", postal_code: "75201", country_code: "us",
          },
          items: [{ variant_id: variantId, quantity: 1, unit_price: 1500 }],
        },
        adminHeaders
      )
      const converted = await api.post(
        `/admin/draft-orders/${draft.data.draft_order.id}/convert-to-order`,
        {},
        adminHeaders
      )
      const orderId = converted.data.order.id

      // The subscriber runs off the order.placed event — poll rather than race.
      let itemRequiresShipping: boolean | undefined
      for (let attempt = 0; attempt < 20; attempt++) {
        const res = await api.get(
          `/admin/orders/${orderId}?fields=id,items.id,items.requires_shipping`,
          adminHeaders
        )
        itemRequiresShipping = res.data.order.items[0].requires_shipping
        if (itemRequiresShipping === true) break
        await new Promise((r) => setTimeout(r, 250))
      }
      expect(itemRequiresShipping).toBe(true)

      // ...and the fulfillment created afterwards inherits the repaired value,
      // so the stock dashboard offers the shipment action with no backfill.
      const shippingOptionId = await createManualShippingOption(api)
      const orderNow = await api.get(
        `/admin/orders/${orderId}?fields=id,items.id`,
        adminHeaders
      )
      await loud("forward fulfillment", () =>
        api.post(
          `/admin/orders/${orderId}/fulfillments`,
          {
            items: [{ id: orderNow.data.order.items[0].id, quantity: 1 }],
            shipping_option_id: shippingOptionId,
          },
          adminHeaders
        )
      )

      const after = await api.get(
        `/admin/orders/${orderId}?fields=id,fulfillments.id,fulfillments.requires_shipping`,
        adminHeaders
      )
      expect(after.data.order.fulfillments[0].requires_shipping).toBe(true)
    })

    /**
     * The repair path for orders that already exist. The admin core gate lives
     * inside the shipped `@medusajs/dashboard` bundle and can't be patched from
     * here, so fixing the DATA is what restores the shipment action there.
     *
     * This also pins the two load-bearing assumptions the DP job makes, neither
     * of which is guaranteed by the public types:
     *  - `requires_shipping` is absent from `UpdateFulfillmentDTO`, but
     *    `updateFulfillment_` spreads `data` into the ORM update, so it writes;
     *  - the job's `query.graph` field list actually resolves (a mis-named
     *    relation returns nothing SILENTLY).
     */
    it("the DP backfill repairs an existing open order's fulfillment and items", async () => {
      const { api } = getSharedTestEnv()
      // Driven through the ops route, so registry wiring and param validation
      // are covered too — this is how an operator actually runs it.
      const RUN =
        "/admin/ops/maintenance-jobs/backfill-open-order-requires-shipping/run"
      const { variantId } = await createProduct(api, {
        withProfile: false,
        label: "Backfill",
      })

      const before = await fulfilOrderFor(api, variantId)
      // The broken starting state.
      expect(before.fulfillment.requires_shipping).toBe(false)
      expect(before.lineItemRequiresShipping).toBe(false)
      expect(before.showShippingButton).toBe(false)

      // Dry-run first: it must report the change without writing anything.
      const preview = await loud("dp dry-run", () =>
        api.post(
          RUN,
          { dry_run: true, params: { order_id: before.orderId } },
          adminHeaders
        )
      )
      expect(preview.status).toBe(200)
      expect(preview.data.result.dry_run).toBe(true)
      expect(preview.data.result.applied).toBe(false)
      expect(
        preview.data.result.changes.some(
          (c: any) =>
            c.entity === "fulfillment" && c.id === before.fulfillment.id
        )
      ).toBe(true)
      // ...but NOT the line item: this product has no shipping profile, and a
      // requires-shipping item whose product profile can't match the chosen
      // option is rejected by create-fulfillment — flipping it would break the
      // remaining quantity instead of revealing the action.
      expect(
        preview.data.result.changes.some(
          (c: any) =>
            c.entity === "order_line_item" && c.id === before.lineItemId
        )
      ).toBe(false)

      const stillBroken = await api.get(
        `/admin/orders/${before.orderId}?fields=id,fulfillments.id,fulfillments.requires_shipping`,
        adminHeaders
      )
      expect(
        stillBroken.data.order.fulfillments[0].requires_shipping
      ).toBe(false)

      // Apply.
      const applied = await loud("dp apply", () =>
        api.post(
          RUN,
          { dry_run: false, params: { order_id: before.orderId } },
          adminHeaders
        )
      )
      expect(applied.status).toBe(200)
      expect(applied.data.result.applied).toBe(true)
      expect(applied.data.result.errors).toBeUndefined()

      const after = await api.get(
        `/admin/orders/${before.orderId}?fields=id,items.id,items.requires_shipping,fulfillments.id,fulfillments.requires_shipping,fulfillments.canceled_at,fulfillments.shipped_at,fulfillments.delivered_at`,
        adminHeaders
      )
      const fulfillment = after.data.order.fulfillments[0]
      expect(fulfillment.requires_shipping).toBe(true)
      // The item is deliberately left alone — see the dry-run assertion above.
      // Fixing it means giving the product a profile
      // (backfill-product-shipping-profiles), not flipping the flag.
      expect(after.data.order.items[0].requires_shipping).toBe(false)

      // The stock dashboard gate now passes — including the undocumented term.
      const showShippingButton =
        !fulfillment.canceled_at &&
        !fulfillment.shipped_at &&
        !fulfillment.delivered_at &&
        fulfillment.requires_shipping
      expect(showShippingButton).toBe(true)

      // Idempotent: a second apply finds nothing left to repair.
      const rerun = await api.post(
        RUN,
        { dry_run: false, params: { order_id: before.orderId } },
        adminHeaders
      )
      expect(rerun.data.result.changes).toHaveLength(0)
      expect(rerun.data.result.applied).toBe(false)
    })

    /**
     * #1195 item 4 — the root repair. A product with a shipping profile derives
     * `requires_shipping: true` on its own, so this is what actually retires
     * the bug for new orders rather than working around it.
     */
    it("the profile backfill links profile-less products and fixes the derivation at source", async () => {
      const { api } = getSharedTestEnv()
      const RUN =
        "/admin/ops/maintenance-jobs/backfill-product-shipping-profiles/run"
      const { productId, variantId, shippingProfile } = await createProduct(api, {
        withProfile: false,
        label: "ProfileFix",
      })
      expect(shippingProfile).toBeNull()

      // Before: the cart derives false, which is the whole defect.
      const itemBefore = await addToCart(api, variantId)
      expect(itemBefore.requires_shipping).toBe(false)

      const preview = await loud("profile dry-run", () =>
        api.post(
          RUN,
          { dry_run: true, params: { product_id: productId } },
          adminHeaders
        )
      )
      expect(preview.data.result.dry_run).toBe(true)
      expect(
        preview.data.result.changes.some(
          (c: any) => c.entity === "product" && c.id === productId
        )
      ).toBe(true)

      const applied = await loud("profile apply", () =>
        api.post(
          RUN,
          { dry_run: false, params: { product_id: productId } },
          adminHeaders
        )
      )
      expect(applied.data.result.applied).toBe(true)
      expect(applied.data.result.errors).toBeUndefined()

      const productAfter = await api.get(
        `/admin/products/${productId}?fields=id,shipping_profile.id`,
        adminHeaders
      )
      expect(productAfter.data.product.shipping_profile?.id).toBe(profileId)

      // After: a NEW cart derives true with no flag-flipping anywhere.
      const itemAfter = await addToCart(api, variantId)
      expect(itemAfter.requires_shipping).toBe(true)

      // Idempotent: the product already has a profile, so it is never relinked.
      const rerun = await api.post(
        RUN,
        { dry_run: false, params: { product_id: productId } },
        adminHeaders
      )
      expect(rerun.data.result.changes).toHaveLength(0)
      expect(rerun.data.result.applied).toBe(false)
    })
  })
})
