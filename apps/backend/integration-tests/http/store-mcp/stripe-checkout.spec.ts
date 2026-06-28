/**
 * Stripe (non-INR) hosted-checkout surface — offline coverage (no live Stripe).
 *
 * Stripe is a first-class Medusa provider, so the webhook → complete → order
 * path is core's job (proven separately). What's ours and offline-testable:
 *   - get_checkout_status route: pending for an open cart, completed (+order_id)
 *     once the cart becomes an order;
 *   - /store/stripe/payment-page: refuses a region with no Stripe provider;
 *   - the self-hosted page GET /stripe/pay/:cart_id: "unavailable" when no Stripe
 *     session exists, "paid" once the cart is completed.
 *
 * The region here is US/USD with pp_system_default linked (setupCheckoutInfra),
 * i.e. NO Stripe provider — exactly the negative case for payment-page, and
 * enough to drive a real cart→order for the status/paid assertions.
 */
import { Modules } from "@medusajs/utils"
import { createAdminUser, getAuthHeaders } from "../../helpers/create-admin-user"
import { createTestCustomer } from "../../helpers/create-customer"
import { setupCheckoutInfrastructure } from "../../helpers/setup-checkout-infrastructure"
import { getSharedTestEnv, setupSharedTestSuite } from "../shared-test-setup"

jest.setTimeout(120000)

setupSharedTestSuite(() => {
  describe("Stripe hosted checkout surface", () => {
    const { api, getContainer } = getSharedTestEnv()

    let pk: string
    let regionId: string
    let variantId: string

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      const adminHeaders = await getAuthHeaders(api)
      const { apiKey } = await createTestCustomer(container)
      pk = apiKey.token

      const region = await api.post(
        "/admin/regions",
        { name: "US", currency_code: "usd", countries: ["us"] },
        adminHeaders
      )
      regionId = region.data.region.id
      const infra = await setupCheckoutInfrastructure(container, regionId)

      const storeService: any = container.resolve(Modules.STORE)
      const store = (await storeService.listStores({}))?.[0]
      const salesChannelId = store?.default_sales_channel_id

      try {
        const remoteLink: any = container.resolve("link")
        await remoteLink.create({
          [Modules.SALES_CHANNEL]: { sales_channel_id: salesChannelId },
          [Modules.STOCK_LOCATION]: { stock_location_id: infra.stockLocation.id },
        })
      } catch {
        // link may already exist
      }

      const product = await api.post(
        "/admin/products",
        {
          title: `Stripe Checkout Test ${Date.now()}`,
          status: "published",
          sales_channels: [{ id: salesChannelId }],
          options: [{ title: "Size", values: ["M"] }],
          variants: [
            {
              title: "M",
              options: { Size: "M" },
              prices: [{ amount: 499, currency_code: "usd" }],
              manage_inventory: false,
            },
          ],
        },
        adminHeaders
      )
      variantId = product.data.product.variants[0].id
    })

    const storeHeaders = () => ({ headers: { "x-publishable-api-key": pk } })

    /** Create a cart that is ready to complete (items + address + shipping). */
    const buildCompletableCart = async (): Promise<string> => {
      const cartRes = await api.post(
        "/store/carts",
        {
          region_id: regionId,
          email: "buyer@jyt.test",
          items: [{ variant_id: variantId, quantity: 1 }],
          shipping_address: {
            first_name: "Asha",
            last_name: "Buyer",
            address_1: "1 Market St",
            city: "New York",
            postal_code: "10001",
            country_code: "us",
          },
        },
        storeHeaders()
      )
      const cartId = cartRes.data.cart.id
      const shippingRes = await api.get(
        `/store/shipping-options?cart_id=${cartId}`,
        storeHeaders()
      )
      const option = shippingRes.data.shipping_options?.[0]
      expect(option?.id).toBeTruthy()
      await api.post(
        `/store/carts/${cartId}/shipping-methods`,
        { option_id: option.id },
        storeHeaders()
      )
      return cartId
    }

    /** Drive a cart to an order via the manual provider. Returns the order id. */
    const completeCart = async (cartId: string): Promise<string> => {
      const pcRes = await api.post(
        "/store/payment-collections",
        { cart_id: cartId },
        storeHeaders()
      )
      const pcId = pcRes.data.payment_collection.id
      await api.post(
        `/store/payment-collections/${pcId}/payment-sessions`,
        { provider_id: "pp_system_default" },
        storeHeaders()
      )
      const completeRes = await api.post(
        `/store/carts/${cartId}/complete`,
        {},
        storeHeaders()
      )
      expect(completeRes.data.type).toBe("order")
      return completeRes.data.order.id
    }

    // ── get_checkout_status route ──────────────────────────────────────────
    it("reports a fresh cart as pending with no order id", async () => {
      const cartId = await buildCompletableCart()
      const res = await api.get(
        `/store/carts/${cartId}/checkout-status`,
        storeHeaders()
      )
      expect(res.status).toBe(200)
      expect(res.data.status).toBe("pending")
      expect(res.data.order_id).toBeNull()
    })

    it("reports completed with the order id once the cart is an order", async () => {
      const cartId = await buildCompletableCart()
      const orderId = await completeCart(cartId)
      const res = await api.get(
        `/store/carts/${cartId}/checkout-status`,
        storeHeaders()
      )
      expect(res.status).toBe(200)
      expect(res.data.status).toBe("completed")
      expect(res.data.order_id).toBe(orderId)
    })

    it("404s an unknown cart", async () => {
      const res = await api
        .get(`/store/carts/cart_does_not_exist/checkout-status`, storeHeaders())
        .catch((e: any) => e.response)
      expect(res.status).toBe(404)
    })

    // ── /store/stripe/payment-page ─────────────────────────────────────────
    it("refuses to build a Stripe page for a region with no Stripe provider", async () => {
      const cartId = await buildCompletableCart()
      const res = await api
        .post("/store/stripe/payment-page", { cart_id: cartId }, storeHeaders())
        .catch((e: any) => e.response)
      expect(res.status).toBe(400)
      expect(String(res.data.error)).toMatch(/stripe/i)
    })

    it("validates cart_id presence", async () => {
      const res = await api
        .post("/store/stripe/payment-page", {}, storeHeaders())
        .catch((e: any) => e.response)
      expect(res.status).toBe(400)
    })

    // ── self-hosted page GET /stripe/pay/:cart_id (public) ─────────────────
    it("renders an 'unavailable' page when the cart has no Stripe session", async () => {
      const cartId = await buildCompletableCart()
      const res = await api
        .get(`/stripe/pay/${cartId}`)
        .catch((e: any) => e.response)
      expect(res.status).toBe(400)
      expect(res.headers["content-type"]).toContain("text/html")
      expect(res.data).toContain("No Stripe payment is initialized")
      // No secret/script leaked on a non-pay state.
      expect(res.data).not.toContain("js.stripe.com")
    })

    it("renders a 'paid' page for a completed cart", async () => {
      const cartId = await buildCompletableCart()
      await completeCart(cartId)
      const res = await api.get(`/stripe/pay/${cartId}`)
      expect(res.status).toBe(200)
      expect(res.headers["content-type"]).toContain("text/html")
      expect(res.data).toContain("Payment received")
    })

    it("404s the page for an unknown cart", async () => {
      const res = await api
        .get(`/stripe/pay/cart_nope`)
        .catch((e: any) => e.response)
      expect(res.status).toBe(404)
      expect(res.data).toContain("not valid")
    })

    // ── set_customer_details route (onboarding) ────────────────────────────
    it("onboards a shopper: sets email + shipping from a flat payload", async () => {
      const cartId = await buildCompletableCart()
      const res = await api.post(
        `/store/carts/${cartId}/customer-details`,
        {
          name: "Asha Buyer",
          email: "asha@jyt.test",
          phone: "+1 555 0100",
          address_1: "9 Pine St",
          city: "Boston",
          postal_code: "02108",
          country_code: "us",
        },
        storeHeaders()
      )
      expect(res.status).toBe(200)
      expect(res.data.cart.email).toBe("asha@jyt.test")
      expect(res.data.cart.shipping_address.first_name).toBe("Asha")
      expect(res.data.cart.shipping_address.last_name).toBe("Buyer")
      expect(res.data.cart.shipping_address.city).toBe("Boston")
    })

    it("400s onboarding with a 'missing' list when required fields are absent", async () => {
      const cartId = await buildCompletableCart()
      const res = await api
        .post(
          `/store/carts/${cartId}/customer-details`,
          { name: "Asha", country_code: "us" },
          storeHeaders()
        )
        .catch((e: any) => e.response)
      expect(res.status).toBe(400)
      expect(res.data.missing).toEqual(
        expect.arrayContaining(["email", "address_1", "city", "postal_code"])
      )
    })

    // ── generate_upi_qr route ──────────────────────────────────────────────
    it("renders a UPI QR data URL from a vpa + amount", async () => {
      const res = await api.post(
        "/store/payu/upi-qr",
        { vpa: "merchant@hdfc", amount: 499, payee_name: "JYT" },
        storeHeaders()
      )
      expect(res.status).toBe(200)
      expect(res.data.upi_link).toContain("pa=merchant%40hdfc")
      expect(res.data.qr_data_url).toMatch(/^data:image\/png;base64,/)
    })

    it("400s the UPI QR with nothing to encode", async () => {
      const res = await api
        .post("/store/payu/upi-qr", {}, storeHeaders())
        .catch((e: any) => e.response)
      expect(res.status).toBe(400)
    })
  })
})
