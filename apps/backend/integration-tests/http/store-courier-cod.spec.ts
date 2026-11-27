import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createShippingOptionsWorkflow } from "@medusajs/medusa/core-flows"

import {
  FLAT_FREIGHT_AMOUNT,
  setupQuoteFixture,
  type QuoteFixture,
} from "../helpers/setup-quote-fixture"
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
 * Now:
 *  - courier + cash needs Delhivery to say the PIN takes COD, an INR cart in
 *    India, no design order / deposit, and the cart total (before the fee) at
 *    or under the cap — ₹15,000 by default, `COD_COURIER_MAX_ORDER_TOTAL_INR`
 *    overrides, "0" switches it off;
 *  - choosing cash adds the ₹200 COD fee to the courier shipping charge (taxed
 *    as shipping is), so it is in the order total the courier collects;
 *  - an allowed order is stamped `metadata.payment_mode = "cod"`, which every
 *    shipment path reads to book a COD parcel for the order total;
 *  - pickup + cash is unchanged, with no fee.
 *
 * Delhivery is faked at the transport (`DELHIVERY_STUB=1`): 799998 → prepaid
 * only (no COD), 799999 → not served, any other pin → COD.
 *
 * The fixture's cart is one ₹35,000 line + ₹15,000 flat freight, so tests that
 * want cash ALLOWED raise the cap; the default-cap test relies on it being over.
 */

const ENV = [
  "DELHIVERY_API_TOKEN",
  "DELHIVERY_STUB",
  "COD_COURIER_MAX_ORDER_TOTAL_INR",
  "COD_COURIER_FEE_INR",
] as const
const saved: Record<string, string | undefined> = {}

const COD_PIN = "190002"
const NO_COD_PIN = "799998"
const FEE = 200

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
      delete process.env.COD_COURIER_FEE_INR
    })

    afterAll(() => {
      for (const k of ENV) {
        if (saved[k] === undefined) delete process.env[k]
        else process.env[k] = saved[k]
      }
    })

    /** A cart with one line and a shipping method; no payment yet. */
    const newCart = async (opts: { pin: string; optionId?: string }) => {
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
      const pcId = (
        await api().post("/store/payment-collections", { cart_id: cart.id }, storeHeaders)
      ).data.payment_collection.id as string
      return { cartId: cart.id as string, pcId }
    }

    const openCashSession = async (pcId: string, data?: Record<string, unknown>) =>
      api().post(
        `/store/payment-collections/${pcId}/payment-sessions`,
        { provider_id: "pp_system_default", ...(data ? { data } : {}) },
        storeHeaders
      )

    /** A cash cart: `newCart` + a `pp_system_default` session. */
    const cashCart = async (opts: {
      pin: string
      optionId?: string
      sessionData?: Record<string, unknown>
    }) => {
      const { cartId, pcId } = await newCart(opts)
      await openCashSession(pcId, opts.sessionData)
      return cartId
    }

    const readCart = async (cartId: string) => {
      const query: any = container().resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "cart",
        fields: [
          "id",
          "total",
          "shipping_total",
          "shipping_methods.id",
          "shipping_methods.amount",
          "shipping_methods.data",
          "payment_collection.amount",
        ],
        filters: { id: cartId },
      })
      return data[0]
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

    const orderTotal = async (orderId: string) => {
      const query: any = container().resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "order",
        fields: ["id", "total", "shipping_methods.amount"],
        filters: { id: orderId },
      })
      return data[0]
    }

    it("places a courier cash order on a COD PIN, with the ₹200 fee in the total the courier collects", async () => {
      const { cartId, pcId } = await newCart({ pin: COD_PIN })
      const before = await readCart(cartId)
      expect(Number(before.shipping_methods[0].amount)).toBe(FLAT_FREIGHT_AMOUNT)

      await openCashSession(pcId)

      // The fee rides on the courier shipping charge, so it is taxed as
      // shipping is and the session/collection are sized for the new total.
      const after = await readCart(cartId)
      expect(Number(after.shipping_methods[0].amount)).toBe(FLAT_FREIGHT_AMOUNT + FEE)
      expect(after.shipping_methods[0].data?.cod_fee).toBe(FEE)
      expect(Number(after.total) - Number(before.total)).toBeGreaterThanOrEqual(FEE)
      expect(Number(after.payment_collection.amount)).toBe(Number(after.total))

      const result = await complete(cartId)
      expect(result).toMatchObject({ ok: true })
      expect(await paymentModeOf(result.orderId!, true)).toBe("cod")

      // The courier collects `order.total` — and it includes the fee.
      const order = await orderTotal(result.orderId!)
      expect(Number(order.total)).toBe(Number(after.total))
      expect(Number(order.shipping_methods[0].amount)).toBe(FLAT_FREIGHT_AMOUNT + FEE)
    })

    it("takes the fee off again when cash is no longer allowed for the cart", async () => {
      const { cartId, pcId } = await newCart({ pin: COD_PIN })
      await openCashSession(pcId)
      expect(Number((await readCart(cartId)).shipping_methods[0].amount)).toBe(
        FLAT_FREIGHT_AMOUNT + FEE
      )

      process.env.COD_COURIER_MAX_ORDER_TOTAL_INR = "1000"
      const freshPc = (
        await api().post("/store/payment-collections", { cart_id: cartId }, storeHeaders)
      ).data.payment_collection.id
      await openCashSession(freshPc)

      const cart = await readCart(cartId)
      expect(Number(cart.shipping_methods[0].amount)).toBe(FLAT_FREIGHT_AMOUNT)
      expect(cart.shipping_methods[0].data?.cod_fee).toBe(0)
    })

    it("refuses a courier cash order whose fee went missing, so the courier is never ₹200 short", async () => {
      const { cartId, pcId } = await newCart({ pin: COD_PIN })
      await openCashSession(pcId)
      const cart = await readCart(cartId)
      const cartModule: any = container().resolve(Modules.CART)
      await cartModule.updateShippingMethods([
        {
          id: cart.shipping_methods[0].id,
          amount: FLAT_FREIGHT_AMOUNT,
          data: { ...(cart.shipping_methods[0].data ?? {}), cod_fee: 0 },
        },
      ])

      const result = await complete(cartId)
      expect(result.ok).toBe(false)
      expect(result.message).toMatch(/₹200 fee that isn't on this order/)
    })

    it("pickup + cash adds no fee", async () => {
      const { cartId, pcId } = await newCart({ pin: COD_PIN, optionId: pickupOptionId })
      await openCashSession(pcId)
      const cart = await readCart(cartId)
      expect(Number(cart.shipping_methods[0].amount)).toBe(0)
      expect(cart.shipping_methods[0].data?.cod_fee ?? 0).toBe(0)
    })

    it("a buyer cannot make a courier cash order ship prepaid by writing cart metadata", async () => {
      const cartId = await cashCart({ pin: COD_PIN })
      // The order copies the cart's metadata, which the store API lets a buyer write.
      await api().post(
        `/store/carts/${cartId}`,
        { metadata: { payment_mode: "prepaid", cod_collect: false } },
        storeHeaders
      )
      // Updating the cart drops the session; choose cash again.
      const pcId = (
        await api().post("/store/payment-collections", { cart_id: cartId }, storeHeaders)
      ).data.payment_collection.id
      await openCashSession(pcId)
      const result = await complete(cartId)

      expect(result).toMatchObject({ ok: true })
      expect(await paymentModeOf(result.orderId!, true)).toBe("cod")
    })

    it("refuses courier cash where Delhivery does not take COD, and adds no fee there", async () => {
      const cartId = await cashCart({ pin: NO_COD_PIN })
      expect(Number((await readCart(cartId)).shipping_methods[0].amount)).toBe(FLAT_FREIGHT_AMOUNT)

      const result = await complete(cartId)
      expect(result.ok).toBe(false)
      expect(result.message).toMatch(/isn't available for this PIN/i)
    })

    it("the cap defaults to ₹15,000 when no override is set", async () => {
      delete process.env.COD_COURIER_MAX_ORDER_TOTAL_INR
      const result = await complete(await cashCart({ pin: COD_PIN }))

      expect(result.ok).toBe(false)
      expect(result.message).toMatch(/up to ₹15,000/)
    })

    it("an override of 0 switches courier COD off", async () => {
      process.env.COD_COURIER_MAX_ORDER_TOTAL_INR = "0"
      const result = await complete(await cashCart({ pin: COD_PIN }))

      expect(result.ok).toBe(false)
      expect(result.message).toMatch(/cash on delivery isn't available/i)
    })

    it("refuses courier cash over an overridden cap, and says the cap", async () => {
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
      process.env.COD_COURIER_MAX_ORDER_TOTAL_INR = "0"
      const result = await complete(await cashCart({ pin: COD_PIN, optionId: pickupOptionId }))

      expect(result).toMatchObject({ ok: true })
      // Give the subscriber its chance, then confirm it left the order alone.
      await new Promise((r) => setTimeout(r, 1500))
      expect(await paymentModeOf(result.orderId!, false)).toBeUndefined()
    })

    it("the delivery check tells the checkout the same answer, and the fee, before the buyer chooses", async () => {
      const { cartId } = await newCart({ pin: COD_PIN })
      const yes = await api().get(
        `/store/delivery-check?country_code=in&postal_code=${COD_PIN}&cart_id=${cartId}`,
        storeHeaders
      )
      expect(yes.data.courier_cod).toEqual({ allowed: true, reason: "allowed", fee: FEE })

      const no = await api().get(
        `/store/delivery-check?country_code=in&postal_code=${NO_COD_PIN}&cart_id=${cartId}`,
        storeHeaders
      )
      expect(no.data.courier_cod).toEqual({ allowed: false, reason: "pin_no_cod", fee: FEE })
    })
  })
})
