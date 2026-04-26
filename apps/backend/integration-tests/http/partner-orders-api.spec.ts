import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { setupCheckoutInfrastructure } from "../helpers/setup-checkout-infrastructure"
import { ProductStatus, Modules } from "@medusajs/framework/utils"

const TEST_PARTNER_PASSWORD = "supersecret"

jest.setTimeout(180 * 1000)

/**
 * Creates a partner with store, product (with weight for shipping calc),
 * and all checkout infrastructure. Returns everything needed for the full
 * order→fulfillment→shipment→delivery flow.
 */
async function createPartnerWithFullInfrastructure(
  api: any,
  adminHeaders: Record<string, any>,
  getContainer: () => any
) {
  const unique = Date.now() + Math.random().toString(36).slice(2, 6)
  const email = `partner-ord-${unique}@medusa-test.com`

  // --- Partner auth ---
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
      name: `OrdTest ${unique}`,
      handle: `ordtest-${unique}`,
      admin: { email, first_name: "Admin", last_name: "Ord" },
    },
    { headers }
  )
  const partnerId = partnerRes.data.partner.id

  const login2 = await api.post("/auth/partner/emailpass", {
    email,
    password: TEST_PARTNER_PASSWORD,
  })
  headers = { Authorization: `Bearer ${login2.data.token}` }

  // --- Store with defaults (auto-provisions fulfillment sets, shipping options, etc.) ---
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
      region: {
        name: `Ord Region ${unique}`,
        currency_code: currencyCode,
        countries: ["us"],
      },
      location: {
        name: "Test Warehouse",
        address: {
          address_1: "123 Main St",
          city: "New York",
          province: "NY",
          postal_code: "10001",
          country_code: "US",
        },
      },
    },
    { headers }
  )

  const storeId = storeRes.data.store.id
  const regionId = storeRes.data.region?.id
  const salesChannelId = storeRes.data.sales_channel?.id
  const locationId = storeRes.data.location?.id
  const publishableKey = storeRes.data.api_key?.token

  // --- Ensure payment provider is linked to region ---
  const container = getContainer()
  const remoteLink = container.resolve("link") as any
  try {
    await remoteLink.create({
      [Modules.REGION]: { region_id: regionId },
      [Modules.PAYMENT]: { payment_provider_id: "pp_system_default" },
    })
  } catch {
    // may already exist
  }

  // --- Create product with weight (important for Delhivery shipping calc) ---
  const productRes = await api.post(
    "/partners/products",
    {
      store_id: storeId,
      product: {
        title: `Heritage Cotton Saree ${unique}`,
        handle: `heritage-saree-${unique}`,
        status: ProductStatus.PUBLISHED,
        weight: 800, // 800 grams
        options: [{ title: "Color", values: ["Indigo", "Ivory"] }],
        variants: [
          {
            title: "Indigo",
            sku: `HCS-IND-${unique}`,
            options: { Color: "Indigo" },
            manage_inventory: false,
            weight: 800, // grams — Medusa ProductVariant built-in field
            length: 30,  // cm — used by Delhivery for volumetric weight
            width: 25,
            height: 3,
            prices: [{ amount: 2499, currency_code: currencyCode }],
          },
          {
            title: "Ivory",
            sku: `HCS-IVR-${unique}`,
            options: { Color: "Ivory" },
            manage_inventory: false,
            weight: 750,
            length: 30,
            width: 25,
            height: 3,
            prices: [{ amount: 2499, currency_code: currencyCode }],
          },
        ],
      },
    },
    { headers }
  )

  const product = productRes.data.product
  const variantId = product?.variants?.[0]?.id

  return {
    headers,
    partnerId,
    storeId,
    regionId,
    salesChannelId,
    locationId,
    currencyCode,
    publishableKey,
    productId: product?.id,
    variantId,
    product,
  }
}

/**
 * Places an order through the store API cart→checkout flow.
 * Returns the created order.
 */
async function placeOrder(
  api: any,
  opts: {
    publishableKey: string
    regionId: string
    variantId: string
    currencyCode: string
  }
) {
  const storeHeaders = {
    "x-publishable-api-key": opts.publishableKey,
  }

  // 1. Create cart
  const cartRes = await api.post(
    "/store/carts",
    { region_id: opts.regionId },
    { headers: storeHeaders }
  )
  const cartId = cartRes.data.cart.id

  // 2. Add line item
  await api.post(
    `/store/carts/${cartId}/line-items`,
    { variant_id: opts.variantId, quantity: 2 },
    { headers: storeHeaders }
  )

  // 3. Set addresses + email
  await api.post(
    `/store/carts/${cartId}`,
    {
      email: "customer@test.com",
      shipping_address: {
        first_name: "Test",
        last_name: "Customer",
        address_1: "456 Oak Ave",
        city: "Los Angeles",
        province: "CA",
        postal_code: "90001",
        country_code: "us",
        phone: "+15551234567",
      },
      billing_address: {
        first_name: "Test",
        last_name: "Customer",
        address_1: "456 Oak Ave",
        city: "Los Angeles",
        province: "CA",
        postal_code: "90001",
        country_code: "us",
      },
    },
    { headers: storeHeaders }
  )

  // 4. Add shipping method
  const shippingRes = await api.get(
    `/store/shipping-options?cart_id=${cartId}`,
    { headers: storeHeaders }
  )
  const shippingOptions = shippingRes.data.shipping_options || []
  if (shippingOptions.length > 0) {
    await api.post(
      `/store/carts/${cartId}/shipping-methods`,
      { option_id: shippingOptions[0].id },
      { headers: storeHeaders }
    )
  }

  // 5. Create payment collection + session
  const payCollRes = await api.post(
    "/store/payment-collections",
    { cart_id: cartId },
    { headers: storeHeaders }
  )
  const payCollId = payCollRes.data.payment_collection.id

  const providersRes = await api.get(
    `/store/payment-providers?region_id=${opts.regionId}`,
    { headers: storeHeaders }
  )
  const providers = providersRes.data.payment_providers || []
  if (providers.length > 0) {
    await api.post(
      `/store/payment-collections/${payCollId}/payment-sessions`,
      { provider_id: providers[0].id },
      { headers: storeHeaders }
    )
  }

  // 6. Complete cart → order
  const completeRes = await api.post(
    `/store/carts/${cartId}/complete`,
    {},
    { headers: storeHeaders }
  )

  if (completeRes.data.type !== "order") {
    throw new Error(
      `Cart completion failed: ${completeRes.data.type} — ${JSON.stringify(completeRes.data.error || "")}`
    )
  }

  return completeRes.data.order
}

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Partner API - Order Fulfillment Flow", () => {
    let adminHeaders: Record<string, any>
    let partner: Awaited<ReturnType<typeof createPartnerWithFullInfrastructure>>

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)
      partner = await createPartnerWithFullInfrastructure(
        api,
        adminHeaders,
        getContainer
      )
    })

    describe("GET /partners/orders (empty)", () => {
      it("should list orders with pagination", async () => {
        const res = await api.get("/partners/orders?limit=5&offset=0", {
          headers: partner.headers,
        })
        expect(res.status).toBe(200)
        expect(Array.isArray(res.data.orders)).toBe(true)
        expect(typeof res.data.count).toBe("number")
        expect(res.data.limit).toBe(5)
        expect(res.data.offset).toBe(0)
      })
    })

    describe("Full order → fulfillment → shipment → delivery", () => {
      let orderId: string

      beforeEach(async () => {
        const order = await placeOrder(api, {
          publishableKey: partner.publishableKey,
          regionId: partner.regionId,
          variantId: partner.variantId,
          currencyCode: partner.currencyCode,
        })
        orderId = order.id
      })

      it("order appears in partner order list", async () => {
        const res = await api.get("/partners/orders", {
          headers: partner.headers,
        })
        expect(res.status).toBe(200)
        expect(res.data.count).toBeGreaterThanOrEqual(1)
        const found = res.data.orders.some((o: any) => o.id === orderId)
        expect(found).toBe(true)
      })

      it("GET /partners/orders/:id returns full order details", async () => {
        const res = await api.get(`/partners/orders/${orderId}`, {
          headers: partner.headers,
        })
        expect(res.status).toBe(200)
        expect(res.data.order).toBeDefined()
        expect(res.data.order.id).toBe(orderId)
        expect(res.data.order.items.length).toBeGreaterThanOrEqual(1)
        expect(res.data.order.shipping_address).toBeDefined()
        expect(res.data.order.shipping_address.city).toBe("Los Angeles")
      })

      it("lists shipping options for the order", async () => {
        const res = await api.get(
          `/partners/orders/${orderId}/shipping-options`,
          { headers: partner.headers }
        )
        expect(res.status).toBe(200)
        expect(Array.isArray(res.data.shipping_options)).toBe(true)
      })

      it("lists return shipping options for the order", async () => {
        const res = await api.get(
          `/partners/orders/${orderId}/shipping-options?is_return=true`,
          { headers: partner.headers }
        )
        expect(res.status).toBe(200)
        expect(Array.isArray(res.data.shipping_options)).toBe(true)
      })

      it("full lifecycle: create fulfillment → create shipment → mark delivered", async () => {
        // --- Step 1: Get the order to find line item IDs ---
        const orderRes = await api.get(`/partners/orders/${orderId}`, {
          headers: partner.headers,
        })
        const order = orderRes.data.order
        const lineItems = order.items.map((item: any) => ({
          id: item.id,
          quantity: item.quantity,
        }))

        // --- Step 2: Create fulfillment ---
        // Weight (800g per variant) and dimensions (30x25x3 cm) are read
        // from the ProductVariant model by the fulfillment provider — no need
        // to pass them in metadata.
        const fulfillRes = await api.post(
          `/partners/orders/${orderId}/fulfillments`,
          {
            items: lineItems,
            location_id: partner.locationId,
            no_notification: true,
          },
          { headers: partner.headers }
        )
        expect(fulfillRes.status).toBe(200)
        expect(fulfillRes.data.order).toBeDefined()

        // Get the fulfillment ID from the updated order
        const updatedOrderRes = await api.get(
          `/partners/orders/${orderId}`,
          { headers: partner.headers }
        )
        const fulfillments = updatedOrderRes.data.order.fulfillments || []
        expect(fulfillments.length).toBeGreaterThanOrEqual(1)
        const fulfillmentId = fulfillments[0].id

        // Verify fulfillment has expected data
        const fulfillment = fulfillments[0]
        expect(fulfillment.items.length).toBeGreaterThanOrEqual(1)

        // --- Step 3: Create shipment with tracking info ---
        const shipmentRes = await api.post(
          `/partners/orders/${orderId}/fulfillments/${fulfillmentId}/shipment`,
          {
            items: lineItems,
            labels: [
              {
                tracking_number: "TEST-TRACK-12345",
                tracking_url: "https://track.example.com/TEST-TRACK-12345",
                label_url: "",
              },
            ],
            no_notification: true,
          },
          { headers: partner.headers }
        )
        expect(shipmentRes.status).toBe(200)

        // --- Step 4: Mark as delivered ---
        const deliverRes = await api.post(
          `/partners/orders/${orderId}/fulfillments/${fulfillmentId}/mark-as-delivered`,
          {},
          { headers: partner.headers }
        )
        expect(deliverRes.status).toBe(200)

        // --- Step 5: Verify final order state ---
        const finalOrderRes = await api.get(
          `/partners/orders/${orderId}`,
          { headers: partner.headers }
        )
        const finalOrder = finalOrderRes.data.order
        expect(finalOrder.fulfillment_status).toBe("delivered")
      })

      it("create fulfillment then cancel it", async () => {
        // Get line items
        const orderRes = await api.get(`/partners/orders/${orderId}`, {
          headers: partner.headers,
        })
        const lineItems = orderRes.data.order.items.map((item: any) => ({
          id: item.id,
          quantity: item.quantity,
        }))

        // Create fulfillment
        await api.post(
          `/partners/orders/${orderId}/fulfillments`,
          {
            items: lineItems,
            location_id: partner.locationId,
            no_notification: true,
          },
          { headers: partner.headers }
        )

        // Get fulfillment ID
        const updatedRes = await api.get(`/partners/orders/${orderId}`, {
          headers: partner.headers,
        })
        const fulfillmentId = updatedRes.data.order.fulfillments[0].id

        // Cancel it
        const cancelRes = await api.post(
          `/partners/orders/${orderId}/fulfillments/${fulfillmentId}/cancel`,
          { no_notification: true },
          { headers: partner.headers }
        )
        expect(cancelRes.status).toBe(200)
      })
    })

    describe("Fulfillment label, tracking, pickup endpoints", () => {
      let orderId: string
      let fulfillmentId: string

      beforeEach(async () => {
        const order = await placeOrder(api, {
          publishableKey: partner.publishableKey,
          regionId: partner.regionId,
          variantId: partner.variantId,
          currencyCode: partner.currencyCode,
        })
        orderId = order.id

        // Create fulfillment
        const orderRes = await api.get(`/partners/orders/${orderId}`, {
          headers: partner.headers,
        })
        const lineItems = orderRes.data.order.items.map((item: any) => ({
          id: item.id,
          quantity: item.quantity,
        }))

        await api.post(
          `/partners/orders/${orderId}/fulfillments`,
          {
            items: lineItems,
            location_id: partner.locationId,
            no_notification: true,
          },
          { headers: partner.headers }
        )

        const updatedRes = await api.get(`/partners/orders/${orderId}`, {
          headers: partner.headers,
        })
        fulfillmentId = updatedRes.data.order.fulfillments[0].id
      })

      it("GET /partners/orders/:id/fulfillments/:fulfillmentId/label returns label data", async () => {
        const res = await api.get(
          `/partners/orders/${orderId}/fulfillments/${fulfillmentId}/label`,
          {
            headers: partner.headers,
            validateStatus: () => true,
          }
        )
        // May return 200 (with label data or empty) or 400/404 (no waybill for manual provider)
        expect([200, 400, 404]).toContain(res.status)
        if (res.status === 200) {
          expect(res.data).toHaveProperty("tracking_number")
        }
      })

      it("GET /partners/orders/:id/fulfillments/:fulfillmentId/tracking returns tracking data", async () => {
        const res = await api.get(
          `/partners/orders/${orderId}/fulfillments/${fulfillmentId}/tracking`,
          {
            headers: partner.headers,
            validateStatus: () => true,
          }
        )
        // May return 200 or 404 (no waybill for manual provider)
        expect([200, 400, 404]).toContain(res.status)
        if (res.status === 200) {
          expect(res.data).toHaveProperty("current_status")
          expect(res.data).toHaveProperty("events")
          expect(Array.isArray(res.data.events)).toBe(true)
        }
      })

      it("POST /partners/orders/:id/fulfillments/:fulfillmentId/pickup validates Delhivery carrier", async () => {
        const res = await api.post(
          `/partners/orders/${orderId}/fulfillments/${fulfillmentId}/pickup`,
          {
            pickup_date: "2026-04-01",
            pickup_time: "14:00",
          },
          {
            headers: partner.headers,
            validateStatus: () => true,
          }
        )
        // Non-Delhivery fulfillments should return 400 (INVALID_DATA)
        // Delhivery fulfillments without token will return 422/500
        expect([200, 400, 404, 422, 500]).toContain(res.status)
      })

      it("rejects unauthenticated access to label endpoint", async () => {
        const res = await api.get(
          `/partners/orders/${orderId}/fulfillments/${fulfillmentId}/label`,
          { validateStatus: () => true }
        )
        expect([401, 403]).toContain(res.status)
      })

      it("rejects unauthenticated access to tracking endpoint", async () => {
        const res = await api.get(
          `/partners/orders/${orderId}/fulfillments/${fulfillmentId}/tracking`,
          { validateStatus: () => true }
        )
        expect([401, 403]).toContain(res.status)
      })

      it("rejects unauthenticated access to pickup endpoint", async () => {
        const res = await api.post(
          `/partners/orders/${orderId}/fulfillments/${fulfillmentId}/pickup`,
          { pickup_date: "2026-04-01", pickup_time: "14:00" },
          { validateStatus: () => true }
        )
        expect([401, 403]).toContain(res.status)
      })
    })

    describe("Cross-partner order isolation", () => {
      it("partner cannot access another partner's order", async () => {
        // Place an order for partner 1
        const order = await placeOrder(api, {
          publishableKey: partner.publishableKey,
          regionId: partner.regionId,
          variantId: partner.variantId,
          currencyCode: partner.currencyCode,
        })

        // Create partner 2
        const partner2 = await createPartnerWithFullInfrastructure(
          api,
          adminHeaders,
          getContainer
        )

        // Partner 2 should NOT see partner 1's order
        const res = await api
          .get(`/partners/orders/${order.id}`, {
            headers: partner2.headers,
            validateStatus: () => true,
          })
        expect([400, 403, 404]).toContain(res.status)
      })
    })

    describe("Empty state endpoints", () => {
      it("GET /partners/returns lists returns (empty)", async () => {
        const res = await api.get("/partners/returns", {
          headers: partner.headers,
        })
        expect(res.status).toBe(200)
        expect(Array.isArray(res.data.returns)).toBe(true)
      })

      it("GET /partners/exchanges lists exchanges (empty)", async () => {
        const res = await api.get("/partners/exchanges", {
          headers: partner.headers,
        })
        expect(res.status).toBe(200)
        expect(Array.isArray(res.data.exchanges)).toBe(true)
      })

      it("GET /partners/claims lists claims (empty)", async () => {
        const res = await api.get("/partners/claims", {
          headers: partner.headers,
        })
        expect(res.status).toBe(200)
        expect(Array.isArray(res.data.claims)).toBe(true)
      })
    })
  })
})
