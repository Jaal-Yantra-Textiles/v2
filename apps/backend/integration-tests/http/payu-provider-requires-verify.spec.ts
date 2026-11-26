/**
 * #2574 — a PayU payment counts only when PayU's verify_payment says so, on the
 * REAL provider path (pp_payu_payu), which is what INR regions use in prod.
 *
 *   1. A paid LINK still completes its cart through pp_payu_payu — both with no
 *      session on the cart and with the buyer's own (unpaid) checkout session
 *      already there. Medusa stores session data as {...caller, ...provider},
 *      so the link's txnid only survives via the server-signed proof.
 *   2. The public POST /store/payu/complete with a made-up mihpayid places NO
 *      order (before #2574 it did: authorize trusted any mihpayid).
 *   3. A store caller cannot put a merchant account (partner key/salt) or a
 *      PayU status into session data.
 *
 * PayU is faked at fetch (verify_payment on postservice.php); nothing leaves.
 */

// The PayU provider only registers when these exist at boot (medusa-config.ts).
process.env.PAYU_MERCHANT_KEY = process.env.PAYU_MERCHANT_KEY || "it_payu_key"
process.env.PAYU_MERCHANT_SALT = process.env.PAYU_MERCHANT_SALT || "it_payu_salt"
process.env.PAYU_MODE = "test"

import { Modules } from "@medusajs/utils"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { createTestCustomer } from "../helpers/create-customer"
import { setupCheckoutInfrastructure } from "../helpers/setup-checkout-infrastructure"
import { processPayuLinkWebhook } from "../../src/api/store/payu/lib/process-link-webhook"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(180000)

/** txnids PayU's (fake) verify_payment reports as paid in full. */
const PAID = new Set<string>()

const realFetch = global.fetch
function installFakePayu() {
  global.fetch = (async (url: any, init?: any) => {
    const u = String(url)
    if (u.includes("payu.in/merchant/postservice")) {
      const txn = new URLSearchParams(String(init?.body ?? "")).get("var1") || ""
      const body = PAID.has(txn)
        ? { status: 1, msg: "ok", transaction_details: { [txn]: { status: "success", mihpayid: `mih_${txn}`, amt: "100000.00" } } }
        : { status: 0, msg: "0 out of 1 Transactions Fetched Successfully", transaction_details: {} }
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })
    }
    return realFetch(url, init)
  }) as any
}

setupSharedTestSuite(() => {
  describe("PayU provider only trusts PayU (#2574)", () => {
    const { api, getContainer } = getSharedTestEnv()

    let pk: string
    let regionId: string
    let variantId: string
    let adminHeaders: any

    beforeAll(() => installFakePayu())
    afterAll(() => {
      global.fetch = realFetch
    })

    beforeEach(async () => {
      PAID.clear()
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)
      const { apiKey } = await createTestCustomer(container)
      pk = apiKey.token

      const region = await api.post(
        "/admin/regions",
        { name: "US", currency_code: "usd", countries: ["us"] },
        adminHeaders
      )
      regionId = region.data.region.id
      const infra = await setupCheckoutInfrastructure(container, regionId)
      // INR regions in prod have PayU enabled → link completion picks pp_payu_payu.
      await api.post(`/admin/regions/${regionId}`, { payment_providers: ["pp_payu_payu"] }, adminHeaders)

      const storeService: any = container.resolve(Modules.STORE)
      const store = (await storeService.listStores({}))?.[0]
      const salesChannelId = store?.default_sales_channel_id
      try {
        await (container.resolve("link") as any).create({
          [Modules.SALES_CHANNEL]: { sales_channel_id: salesChannelId },
          [Modules.STOCK_LOCATION]: { stock_location_id: infra.stockLocation.id },
        })
      } catch {
        /* exists */
      }

      const product = await api.post(
        "/admin/products",
        {
          title: `PayU verify ${Date.now()}`,
          status: "published",
          sales_channels: [{ id: salesChannelId }],
          options: [{ title: "Size", values: ["M"] }],
          variants: [
            { title: "M", options: { Size: "M" }, prices: [{ amount: 499, currency_code: "usd" }], manage_inventory: false },
          ],
        },
        adminHeaders
      )
      variantId = product.data.product.variants[0].id
    })

    const sh = () => ({ headers: { "x-publishable-api-key": pk } })

    const buildCart = async (): Promise<string> => {
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
        sh()
      )
      const cartId = cartRes.data.cart.id
      const so = await api.get(`/store/shipping-options?cart_id=${cartId}`, sh())
      await api.post(`/store/carts/${cartId}/shipping-methods`, { option_id: so.data.shipping_options[0].id }, sh())
      return cartId
    }

    const startPayuCheckout = async (cartId: string, data?: Record<string, unknown>) => {
      const pc = await api.post("/store/payment-collections", { cart_id: cartId }, sh())
      const pcId = pc.data.payment_collection.id
      const res = await api.post(
        `/store/payment-collections/${pcId}/payment-sessions`,
        { provider_id: "pp_payu_payu", ...(data ? { data } : {}) },
        sh()
      )
      return res.data.payment_collection.payment_sessions.find((s: any) => s.provider_id === "pp_payu_payu")
    }

    const verifyOk = jest.fn(async () => ({ paid: true, status: "success", amount: 100000, raw: {} }))

    it("a paid link completes through pp_payu_payu when the cart has no session", async () => {
      const cartId = await buildCart()
      PAID.add("link_918300")
      const r = await processPayuLinkWebhook(
        getContainer(),
        { status: "success", udf1: cartId, txnid: "link_918300", mihpayid: "mih_link_918300" },
        { verifyTransaction: verifyOk }
      )
      expect(r.completed).toBe(true)
      expect(typeof r.order_id).toBe("string")
    })

    it("a paid link completes even when the buyer's own unpaid checkout session is on the cart", async () => {
      const cartId = await buildCart()
      const session = await startPayuCheckout(cartId)
      expect(session?.data?.txnid).toBeTruthy()
      PAID.add("link_918301")
      const r = await processPayuLinkWebhook(
        getContainer(),
        { status: "success", udf1: cartId, txnid: "link_918301", mihpayid: "mih_link_918301" },
        { verifyTransaction: verifyOk }
      )
      expect(r.completed).toBe(true)
      expect(typeof r.order_id).toBe("string")
    })

    it("POST /store/payu/complete with a made-up mihpayid places no order", async () => {
      const cartId = await buildCart()
      await startPayuCheckout(cartId)
      const res = await api
        .post(
          "/store/payu/complete",
          { cart_id: cartId, payu_status: "success", mihpayid: "made-up-123", txnid: "anything" },
          sh()
        )
        .catch((e: any) => e.response)
      expect(res.data?.type).not.toBe("order")
      expect(res.data?.order_id).toBeFalsy()

      const { data: carts } = await (getContainer().resolve("query") as any).graph({
        entity: "cart",
        fields: ["id", "completed_at"],
        filters: { id: cartId },
      })
      expect(carts[0].completed_at).toBeFalsy()
    })

    it("POST /store/payu/complete DOES place the order once PayU verifies the session's own txnid", async () => {
      const cartId = await buildCart()
      const session = await startPayuCheckout(cartId)
      PAID.add(session.data.txnid)
      const res = await api.post(
        "/store/payu/complete",
        { cart_id: cartId, payu_status: "success", mihpayid: `mih_${session.data.txnid}`, txnid: session.data.txnid },
        sh()
      )
      expect(res.data.type).toBe("order")
    })

    it("a store caller cannot inject a merchant account or a PayU status into session data", async () => {
      const cartId = await buildCart()
      const session = await startPayuCheckout(cartId, {
        partner_merchant_key: "attacker_key",
        partner_merchant_salt: "attacker_salt",
        payu_status: "success",
        mihpayid: "1",
      })
      expect(session.data.partner_merchant_key).toBeUndefined()
      expect(session.data.partner_merchant_salt).toBeUndefined()
      expect(session.data.mihpayid).toBeUndefined()
      expect(session.data.payu_status).toBeUndefined()
    })
  })
})
