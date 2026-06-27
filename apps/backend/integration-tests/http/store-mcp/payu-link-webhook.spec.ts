/**
 * PayU payment-link webhook → order completion (offline, no live gateway).
 *
 * The webhook authenticates via server-side re-verification (verify_payment /
 * OneAPI /txns), NOT the inbound hash — PayU signs link webhooks with the
 * unreproducible Salt-v2/RSA scheme (see verify-payment.ts). So:
 *   - HTTP layer: a non-success event is acked without completing; a success
 *     event that can't be re-verified (no creds) is acked as not-completed
 *     (never an order).
 *   - Orchestrator layer (processPayuLinkWebhook with an injected verifier):
 *     a PayU-confirmed payment completes the cart into an order and is
 *     idempotent on replay; a PayU-denied payment never completes.
 *
 * The live gateway path stays opt-in in store-mcp-payu-live.spec.ts.
 */
import { Modules } from "@medusajs/utils"
import { createAdminUser, getAuthHeaders } from "../../helpers/create-admin-user"
import { createTestCustomer } from "../../helpers/create-customer"
import { setupCheckoutInfrastructure } from "../../helpers/setup-checkout-infrastructure"
import { processPayuLinkWebhook } from "../../../src/api/store/payu/lib/process-link-webhook"
import { getSharedTestEnv, setupSharedTestSuite } from "../shared-test-setup"

jest.setTimeout(120000)

const FORM = { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
const postWebhook = (api: any, payload: Record<string, string>) =>
  api.post("/webhooks/payu/link", new URLSearchParams(payload).toString(), FORM)

setupSharedTestSuite(() => {
  describe("PayU payment-link webhook → order", () => {
    const { api, getContainer } = getSharedTestEnv()

    let prevKey: string | undefined
    let pk: string
    let regionId: string
    let variantId: string

    beforeEach(async () => {
      prevKey = process.env.PAYU_MERCHANT_KEY
      // No classic creds in the test env → the default re-verifier is a no-op
      // (returns null, never hits the network). Orchestrator tests inject their
      // own verifier instead.
      delete process.env.PAYU_MERCHANT_KEY

      const container = getContainer()
      await createAdminUser(container)
      const adminHeaders = await getAuthHeaders(api)
      const { apiKey } = await createTestCustomer(container)
      pk = apiKey.token

      // setupCheckoutInfrastructure seeds a US/USD shipping zone + flat-rate and
      // links pp_system_default (the provider the webhook authorizes the
      // out-of-band link payment with) to the region — so the cart must be
      // US/USD to match. Completion is currency-agnostic; real PayU links are INR.
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

      // /store/shipping-options filters by stock locations reachable from the
      // cart's sales channel — link the location to the sales channel too.
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
          title: `PayU Webhook Test ${Date.now()}`,
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

    afterEach(() => {
      if (prevKey === undefined) delete process.env.PAYU_MERCHANT_KEY
      else process.env.PAYU_MERCHANT_KEY = prevKey
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

    // ── HTTP layer ────────────────────────────────────────────────────────
    it("acks a verified non-success event without completing", async () => {
      const res = await postWebhook(api, { status: "failure", udf1: "cart_x", txnid: "t1" })
      expect(res.status).toBe(200)
      expect(res.data.received).toBe(true)
      expect(res.data.completed).toBeUndefined()
    })

    it("acks (not-completed) a success event that cannot be re-verified", async () => {
      // No PayU creds → re-verification can't confirm → must NOT complete, but
      // still 200 so PayU stops retrying. The hash is irrelevant (never a gate).
      const res = await postWebhook(api, {
        status: "success",
        udf1: "cart_does_not_exist",
        txnid: "t2",
        hash: "deadbeef",
      })
      expect(res.status).toBe(200)
      expect(res.data.completed).toBe(false)
    })

    // ── Orchestrator layer (injected verifier) ─────────────────────────────
    it("completes the cart into an order when PayU re-verification confirms it, idempotently", async () => {
      const cartId = await buildCompletableCart()
      const payload = { status: "success", udf1: cartId, txnid: "918188", mihpayid: "mih_1" }
      const verifyTransaction = jest.fn(async () => ({
        paid: true,
        status: "success",
        amount: 9999,
        raw: {},
      }))

      const r1 = await processPayuLinkWebhook(getContainer(), payload, { verifyTransaction })
      expect(r1.completed).toBe(true)
      expect(typeof r1.order_id).toBe("string")
      expect(verifyTransaction).toHaveBeenCalledWith("918188", expect.anything())

      // Replay → idempotent: same order, no second completion.
      const r2 = await processPayuLinkWebhook(getContainer(), payload, { verifyTransaction })
      expect(r2.completed).toBe(true)
      expect(r2.order_id).toBe(r1.order_id)
    })

    it("never completes when PayU re-verification denies the payment", async () => {
      const cartId = await buildCompletableCart()
      const payload = { status: "success", udf1: cartId, txnid: "918189" }
      const verifyTransaction = jest.fn(async () => ({
        paid: false,
        status: "failure",
        amount: null,
        raw: {},
      }))

      const r = await processPayuLinkWebhook(getContainer(), payload, { verifyTransaction })
      expect(r.completed).toBe(false)
      expect(r.reason).toBe("not_verified")
    })

    it("reports cart_not_found without throwing for an unknown cart", async () => {
      const verifyTransaction = jest.fn(async () => ({ paid: true, status: "success", amount: 1, raw: {} }))
      const r = await processPayuLinkWebhook(
        getContainer(),
        { status: "success", udf1: "cart_nope", txnid: "t3" },
        { verifyTransaction }
      )
      expect(r.completed).toBe(false)
      expect(r.reason).toBe("cart_not_found")
    })
  })
})
