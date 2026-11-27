import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createShippingOptionsWorkflow } from "@medusajs/medusa/core-flows"

import { setupQuoteFixture, type QuoteFixture } from "../helpers/setup-quote-fixture"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(240 * 1000)

/**
 * Cash on delivery by COURIER (founder, 2026-11-27).
 *
 * Until now cash was pickup-only and only the storefront enforced it: a buyer
 * (or an agent on the store MCP) could pick `pp_system_default` on a courier
 * method through the API, and the parcel was then booked PREPAID — the courier
 * collected nothing.
 *
 * Now the server decides, when the cart completes:
 *  - courier + cash needs Delhivery to say the PIN takes COD, an INR cart in
 *    India, no design order / deposit, and the founder's cap
 *    (`COD_COURIER_MAX_ORDER_TOTAL_INR`; unset = courier COD off);
 *  - an allowed order is stamped `metadata.payment_mode = "cod"`, which every
 *    shipment path reads to book a COD parcel for the order total;
 *  - pickup + cash is unchanged.
 *
 * Delhivery is faked at the transport (`DELHIVERY_STUB=1`): 799998 → prepaid
 * only (no COD), 799999 → not served, any other pin → COD.
 */

const ENV = ["DELHIVERY_API_TOKEN", "DELHIVERY_STUB", "COD_COURIER_MAX_ORDER_TOTAL_INR"] as const
const saved: Record<string, string | undefined> = {}

const COD_PIN = "190002"
const NO_COD_PIN = "799998"

setupSharedTestSuite(() => {
  describe("courier cash on delivery", () => {
    let seed: QuoteFixture
    let storeHeaders: { headers: Record<string, string> }
    let pickupOptionId: string

    const container = () => getSharedTestEnv().getContainer()
    const api = () => getSharedTestEnv().api

    beforeAll(async () => {
      for (const k of ENV) saved[k] = process.env[k]
      const { api, getContainer } = getSharedTestEnv()
      seed = await setupQuoteFixture(api, getContainer)
      storeHeaders = { headers: { "x-publishable-api-key": seed.publishableKey } }

      // A pickup option on the same location, so pickup + cash can be checked.
      const fulfillment: any = getContainer().resolve(Modules.FULFILLMENT)
      const link: any = getContainer().resolve("link")
      const [profile] = await fulfillment.listShippingProfiles({})
      const pickupSet = await fulfillment.createFulfillmentSets({
        name: `Pickup ${seed.unique}`,
        type: "pickup",
      })
      const pickupZone = await fulfillment.createServiceZones({
        name: `Pickup zone ${seed.unique}`,
        fulfillment_set_id: pickupSet.id,
        geo_zones: [{ type: "country", country_code: "in" }],
      })
      await link
        .create({
          [Modules.STOCK_LOCATION]: { stock_location_id: seed.locationId },
          [Modules.FULFILLMENT]: { fulfillment_set_id: pickupSet.id },
        })
        .catch(() => {})
      const { result } = await createShippingOptionsWorkflow(getContainer()).run({
        input: [
          {
            name: `Pickup ${seed.unique}`,
            service_zone_id: pickupZone.id,
            shipping_profile_id: profile.id,
            provider_id: "manual_manual",
            type: { label: "Pickup", description: "Collect in store", code: "pickup" },
            price_type: "flat",
            prices: [{ amount: 0, currency_code: seed.currencyCode }],
            rules: [
              { attribute: "enabled_in_store", value: "true", operator: "eq" },
              { attribute: "is_return", value: "false", operator: "eq" },
            ],
          } as any,
        ],
      })
      pickupOptionId = (result as any[])[0].id
    })

    beforeEach(() => {
      process.env.DELHIVERY_API_TOKEN = "test-delhivery-token"
      process.env.DELHIVERY_STUB = "1"
      process.env.COD_COURIER_MAX_ORDER_TOTAL_INR = "100000"
    })

    afterAll(() => {
      for (const k of ENV) {
        if (saved[k] === undefined) delete process.env[k]
        else process.env[k] = saved[k]
      }
    })

    /** A cash cart: one line, a shipping method, a `pp_system_default` session. */
    const cashCart = async (opts: {
      pin: string
      optionId?: string
      sessionData?: Record<string, unknown>
    }) => {
      const cart = (
        await api().post(
          "/store/carts",
          {
            region_id: seed.regionId,
            email: `cod-${seed.unique}-${Date.now()}@jaalyantra.test`,
            items: [{ variant_id: seed.variantA.id, quantity: 1 }],
            shipping_address: {
              first_name: "Cash",
              last_name: "Buyer",
              address_1: "4 Lal Chowk",
              city: "Srinagar",
              province: "JK",
              postal_code: opts.pin,
              country_code: "in",
              phone: "+919000000001",
            },
          },
          storeHeaders
        )
      ).data.cart
      await api().post(
        `/store/carts/${cart.id}/shipping-methods`,
        { option_id: opts.optionId ?? seed.shippingOptionId },
        storeHeaders
      )
      const pc = (
        await api().post("/store/payment-collections", { cart_id: cart.id }, storeHeaders)
      ).data.payment_collection
      await api().post(
        `/store/payment-collections/${pc.id}/payment-sessions`,
        { provider_id: "pp_system_default", ...(opts.sessionData ? { data: opts.sessionData } : {}) },
        storeHeaders
      )
      return cart.id as string
    }

    /** Complete; normalise core's two failure shapes (400, or 200 + type "cart"). */
    const complete = async (cartId: string) => {
      const res = await api()
        .post(`/store/carts/${cartId}/complete`, {}, storeHeaders)
        .catch((e: any) => e.response)
      if (res.status === 200 && res.data?.type === "order") {
        return { ok: true as const, orderId: res.data.order.id as string, message: "" }
      }
      return {
        ok: false as const,
        orderId: null,
        message: String(res.data?.error?.message ?? res.data?.message ?? ""),
      }
    }

    /** The stamp is written by an `order.placed` subscriber — wait for it. */
    const paymentModeOf = async (orderId: string, waitForCod: boolean) => {
      const query: any = container().resolve(ContainerRegistrationKeys.QUERY)
      let mode: unknown
      for (let i = 0; i < 30; i++) {
        const { data } = await query.graph({
          entity: "order",
          fields: ["id", "metadata"],
          filters: { id: orderId },
        })
        mode = data?.[0]?.metadata?.payment_mode
        if (!waitForCod || mode === "cod") break
        await new Promise((r) => setTimeout(r, 200))
      }
      return mode
    }

    it("places a courier cash order on a COD PIN and stamps it COD for the courier", async () => {
      const result = await complete(await cashCart({ pin: COD_PIN }))

      expect(result).toMatchObject({ ok: true })
      expect(await paymentModeOf(result.orderId!, true)).toBe("cod")
    })

    it("a buyer cannot make a courier cash order ship prepaid by writing cart metadata", async () => {
      const cartId = await cashCart({ pin: COD_PIN })
      // The order copies the cart's metadata, which the store API lets a buyer write.
      await api().post(
        `/store/carts/${cartId}`,
        { metadata: { payment_mode: "prepaid", cod_collect: false } },
        storeHeaders
      )
      const result = await complete(cartId)

      expect(result).toMatchObject({ ok: true })
      expect(await paymentModeOf(result.orderId!, true)).toBe("cod")
    })

    it("refuses courier cash where Delhivery does not take COD", async () => {
      const result = await complete(await cashCart({ pin: NO_COD_PIN }))

      expect(result.ok).toBe(false)
      expect(result.message).toMatch(/isn't available for this PIN/i)
    })

    it("refuses courier cash while the founder's cap is unset (courier COD off)", async () => {
      delete process.env.COD_COURIER_MAX_ORDER_TOTAL_INR
      const result = await complete(await cashCart({ pin: COD_PIN }))

      expect(result.ok).toBe(false)
      expect(result.message).toMatch(/cash on delivery isn't available/i)
    })

    it("refuses courier cash over the cap, and says the cap", async () => {
      process.env.COD_COURIER_MAX_ORDER_TOTAL_INR = "1000"
      const result = await complete(await cashCart({ pin: COD_PIN }))

      expect(result.ok).toBe(false)
      expect(result.message).toMatch(/up to ₹1,000/)
    })

    it("a buyer cannot claim 'already paid' to skip the check", async () => {
      // `external_payment` marks a PAID link's completion; the store
      // payment-sessions route must strip it from buyer data.
      const result = await complete(
        await cashCart({ pin: NO_COD_PIN, sessionData: { external_payment: { txnid: "fake" } } })
      )

      expect(result.ok).toBe(false)
      expect(result.message).toMatch(/isn't available for this PIN/i)
    })

    it("pickup + cash still works with courier COD off, and is not stamped COD", async () => {
      delete process.env.COD_COURIER_MAX_ORDER_TOTAL_INR
      const result = await complete(await cashCart({ pin: COD_PIN, optionId: pickupOptionId }))

      expect(result).toMatchObject({ ok: true })
      // Give the subscriber its chance, then confirm it left the order alone.
      await new Promise((r) => setTimeout(r, 1500))
      expect(await paymentModeOf(result.orderId!, false)).toBeUndefined()
    })

    it("the delivery check tells the checkout the same answer the server will give", async () => {
      const cartId = await cashCart({ pin: COD_PIN })
      const yes = await api().get(
        `/store/delivery-check?country_code=in&postal_code=${COD_PIN}&cart_id=${cartId}`,
        storeHeaders
      )
      expect(yes.data.courier_cod).toEqual({ allowed: true, reason: "allowed" })

      const no = await api().get(
        `/store/delivery-check?country_code=in&postal_code=${NO_COD_PIN}&cart_id=${cartId}`,
        storeHeaders
      )
      expect(no.data.courier_cod).toEqual({ allowed: false, reason: "pin_no_cod" })
    })
  })
})
