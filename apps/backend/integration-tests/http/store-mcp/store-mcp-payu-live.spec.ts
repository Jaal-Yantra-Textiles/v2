/**
 * LIVE PayU end-to-end test through the MCP. Opt-in only:
 *   PAYU_LIVE_TEST=1 pnpm test:integration:http:shared \
 *     ./integration-tests/http/store-mcp/store-mcp-payu-live.spec.ts
 *
 * Requires the PayU provider registered (medusa-config registers it when
 * PAYU_MERCHANT_KEY is set) and, for the payment link, the OneAPI test creds
 * (PAYU_CLIENT_ID/SECRET/MERCHANT_ID, PAYU_ONEAPI_MODE=test). Hits REAL PayU
 * test endpoints, so it is skipped unless PAYU_LIVE_TEST is set.
 */
import { Modules } from "@medusajs/utils"
import { createAdminUser, getAuthHeaders } from "../../helpers/create-admin-user"
import { createTestCustomer } from "../../helpers/create-customer"
import { getSharedTestEnv, setupSharedTestSuite } from "../shared-test-setup"

jest.setTimeout(180000)

const MCP_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
}
const rpc = (method: string, params: Record<string, unknown>, id = 1) => ({
  jsonrpc: "2.0",
  id,
  method,
  params,
})

const RUN = !!process.env.PAYU_LIVE_TEST
const d = RUN ? describe : describe.skip

setupSharedTestSuite(() => {
  d("Store MCP — LIVE PayU flow (cart → UPI intent + payment link)", () => {
    const { api, getContainer } = getSharedTestEnv()

    let pk: string
    let regionId: string
    let variantId: string

    const callTool = async (name: string, args: Record<string, unknown>) => {
      const res = await api.post(
        "/store/mcp",
        rpc("tools/call", { name, arguments: args }),
        { headers: { ...MCP_HEADERS, "x-publishable-api-key": pk } }
      )
      expect(res.status).toBe(200)
      const text = res.data?.result?.content?.[0]?.text
      if (res.data?.result?.isError) {
        throw new Error(`${name} in-band error: ${text}`)
      }
      return JSON.parse(text)
    }

    beforeEach(async () => {
      process.env.STORE_MCP_ENABLE_WRITE = "true"
      const container = getContainer()
      await createAdminUser(container)
      const adminHeaders = await getAuthHeaders(api)
      const { apiKey } = await createTestCustomer(container)
      pk = apiKey.token

      // Default sales channel the publishable key is linked to.
      const storeService: any = container.resolve(Modules.STORE)
      const store = (await storeService.listStores({}))?.[0]
      const salesChannelId = store?.default_sales_channel_id

      // INR region with the PayU provider enabled.
      const region = await api.post(
        "/admin/regions",
        { name: "India", currency_code: "inr", countries: ["in"], payment_providers: ["pp_payu_payu"] },
        adminHeaders
      )
      regionId = region.data.region.id

      // A published INR product in the key's sales channel.
      const product = await api.post(
        "/admin/products",
        {
          title: `PayU Live Test ${Date.now()}`,
          status: "published",
          sales_channels: [{ id: salesChannelId }],
          options: [{ title: "Size", values: ["M"] }],
          variants: [
            {
              title: "M",
              options: { Size: "M" },
              prices: [{ amount: 499, currency_code: "inr" }],
              manage_inventory: false,
            },
          ],
        },
        adminHeaders
      )
      variantId = product.data.product.variants[0].id
    })

    afterEach(() => {
      delete process.env.STORE_MCP_ENABLE_WRITE
    })

    it("create_cart → initialize PayU session → payu_generate_upi_intent → upi://pay link", async () => {
      const cart = await callTool("create_cart", {
        region_id: regionId,
        email: "buyer@jyt.test",
        items: [{ variant_id: variantId, quantity: 1 }],
      })
      const cartId = cart.cart.id
      expect(cartId).toBeTruthy()

      const coll = await callTool("create_payment_collection", { cart_id: cartId })
      const collId = coll.payment_collection.id

      const init = await callTool("initialize_payment_session", {
        id: collId,
        provider_id: "pp_payu_payu",
      })
      // PayU initiate returns the hosted fields; next_action is a redirect_form.
      expect(init.next_action?.provider).toBe("payu")

      const intent = await callTool("payu_generate_upi_intent", { cart_id: cartId })
      // eslint-disable-next-line no-console
      console.log("[payu-live] UPI intent:", intent.upi_link)
      expect(typeof intent.upi_link).toBe("string")
      expect(intent.upi_link).toMatch(/^upi:\/\/pay\?/)
    })

    it("create_payment_link({cart_id}) → shareable v.payu.in link", async () => {
      if (!process.env.PAYU_CLIENT_ID) {
        // eslint-disable-next-line no-console
        console.log("[payu-live] skipping payment link — no PAYU_CLIENT_ID")
        return
      }
      const cart = await callTool("create_cart", {
        region_id: regionId,
        email: "buyer@jyt.test",
        items: [{ variant_id: variantId, quantity: 1 }],
      })
      const link = await callTool("create_payment_link", { cart_id: cart.cart.id })
      // eslint-disable-next-line no-console
      console.log("[payu-live] payment link:", link.payment_link)
      expect(typeof link.payment_link).toBe("string")
      expect(link.payment_link).toMatch(/payu\.in/)
    })
  })
})
