/**
 * PayU payment-link webhook → order completion (offline, no live gateway).
 *
 * Exercises the HTTP behaviour of `POST /webhooks/payu/link` that the pure
 * helpers (verifyWebhookHash / isLinkPaid — unit-tested in
 * src/api/store/payu/payment-link/__tests__) cannot cover:
 *   - a tampered/invalid reverse-SHA512 hash is rejected (401),
 *   - a verified-but-not-success event is acked without completing (200),
 *   - a verified success event with udf1=<cart> completes the cart into an
 *     order via the manual provider, and a replayed event is idempotent.
 *
 * The OneAPI re-verification branch is intentionally skipped here: the seeded
 * cart carries no `payu_invoice_number`, so the route proceeds "on hash only"
 * (its documented fallback) without reaching out to PayU. The live gateway path
 * is covered separately by store-mcp-payu-live.spec.ts (opt-in PAYU_LIVE_TEST).
 */
import { createHash } from "crypto"
import { Modules } from "@medusajs/utils"
import { createAdminUser, getAuthHeaders } from "../../helpers/create-admin-user"
import { createTestCustomer } from "../../helpers/create-customer"
import { setupCheckoutInfrastructure } from "../../helpers/setup-checkout-infrastructure"
import { getSharedTestEnv, setupSharedTestSuite } from "../shared-test-setup"

jest.setTimeout(120000)

const sha512Hex = (s: string) => createHash("sha512").update(s).digest("hex")

/**
 * Build a webhook payload whose `hash` matches the route's reverse-SHA512
 * verification (mirrors verifyWebhookHash's signing string, no
 * additionalCharges). Salt must equal PAYU_MERCHANT_SALT.
 */
const signedPayload = (
  salt: string,
  fields: Record<string, string>
): Record<string, string> => {
  const p = {
    status: "success",
    udf1: "",
    udf2: "",
    udf3: "",
    udf4: "",
    udf5: "",
    email: "buyer@jyt.test",
    firstname: "Asha",
    productinfo: "Order",
    amount: "1.00",
    txnid: "txn_test_1",
    key: "TESTKEY",
    mihpayid: "mih_1",
    mode: "UPI",
    bank_ref_num: "ref_1",
    ...fields,
  }
  const tail = [
    p.status, "", "", "", "", "",
    p.udf5, p.udf4, p.udf3, p.udf2, p.udf1,
    p.email, p.firstname, p.productinfo, p.amount, p.txnid, p.key,
  ]
  return { ...p, hash: sha512Hex([salt, ...tail].join("|")) }
}

const FORM = { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
const postWebhook = (api: any, payload: Record<string, string>) =>
  api.post("/webhooks/payu/link", new URLSearchParams(payload).toString(), FORM)

setupSharedTestSuite(() => {
  describe("PayU payment-link webhook → order", () => {
    const { api, getContainer } = getSharedTestEnv()

    const SALT = "WEBHOOK_TEST_SALT"
    let prevSalt: string | undefined
    let pk: string
    let regionId: string
    let variantId: string

    beforeEach(async () => {
      prevSalt = process.env.PAYU_MERCHANT_SALT
      process.env.PAYU_MERCHANT_SALT = SALT

      const container = getContainer()
      await createAdminUser(container)
      const adminHeaders = await getAuthHeaders(api)
      const { apiKey } = await createTestCustomer(container)
      pk = apiKey.token

      // setupCheckoutInfrastructure seeds a US/USD shipping zone + flat rate and
      // links pp_system_default (the provider the webhook authorizes the
      // out-of-band link payment with) to the region — so the cart must be
      // US/USD to match. The completion path is currency-agnostic; real PayU
      // links are INR and covered by the live spec.
      const region = await api.post(
        "/admin/regions",
        { name: "US", currency_code: "usd", countries: ["us"] },
        adminHeaders
      )
      regionId = region.data.region.id
      const infra = await setupCheckoutInfrastructure(container, regionId)

      // Published product in the publishable key's default sales channel.
      const storeService: any = container.resolve(Modules.STORE)
      const store = (await storeService.listStores({}))?.[0]
      const salesChannelId = store?.default_sales_channel_id

      // /store/shipping-options filters by stock locations reachable from the
      // cart's sales channel — the helper links the location to fulfillment but
      // not to the sales channel, so do that here or options come back empty.
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
      if (prevSalt === undefined) delete process.env.PAYU_MERCHANT_SALT
      else process.env.PAYU_MERCHANT_SALT = prevSalt
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

    it("rejects a tampered/invalid signature with 401", async () => {
      const payload = signedPayload(SALT, { udf1: "cart_x" })
      payload.amount = "9999.00" // mutate after signing → hash no longer matches
      const res = await postWebhook(api, payload).catch((e: any) => e.response)
      expect(res.status).toBe(401)
    })

    it("acks a verified non-success event without completing", async () => {
      const payload = signedPayload(SALT, { status: "failure", udf1: "cart_x" })
      const res = await postWebhook(api, payload)
      expect(res.status).toBe(200)
      expect(res.data.received).toBe(true)
      expect(res.data.completed).toBeUndefined()
    })

    it("completes the cart into an order on a verified success, idempotently", async () => {
      const cartId = await buildCompletableCart()

      const payload = signedPayload(SALT, { udf1: cartId })
      const res = await postWebhook(api, payload)
      expect(res.status).toBe(200)
      expect(res.data.completed).toBe(true)
      expect(typeof res.data.order_id).toBe("string")
      const orderId = res.data.order_id

      // Replayed webhook → same order, no duplicate completion.
      const replay = await postWebhook(api, payload)
      expect(replay.status).toBe(200)
      expect(replay.data.order_id).toBe(orderId)
    })

    it("returns 500 when PAYU_MERCHANT_SALT is not configured", async () => {
      delete process.env.PAYU_MERCHANT_SALT
      const res = await postWebhook(api, signedPayload(SALT, { udf1: "cart_x" })).catch(
        (e: any) => e.response
      )
      expect(res.status).toBe(500)
    })
  })
})
