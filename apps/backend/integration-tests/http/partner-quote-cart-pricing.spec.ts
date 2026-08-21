import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { pickTestPaymentProvider } from "../helpers/pick-payment-provider"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  setupQuoteFixture,
  mintBody,
  type QuoteFixture,
  FLAT_FREIGHT_AMOUNT,
  VARIANT_A_PRICE,
  VARIANT_A_TIER_PRICE,
  VARIANT_A_TIER_MIN_QTY,
  VARIANT_B_PRICE,
} from "../helpers/setup-quote-fixture"

jest.setTimeout(300 * 1000)

const BUYER_PASSWORD = "supersecret"

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
 * Does the quote actually price the buyer's cart? (#1389 S3, store side.)
 *
 * ## What the mint suite cannot tell you
 *
 * `partner-quote-mint.spec.ts` proves a price list was written with the right
 * amounts and exactly one customer-group rule. It does NOT prove that the
 * buyer, in a real cart, is charged those amounts — that depends on core's
 * price resolution, on the cart carrying the right customer, and on the group
 * link surviving. **A minted price list nobody is priced by is a no-op**, and
 * the mint suite would stay green through it.
 *
 * So this file drives the storefront: a real customer, a real cart, real
 * shipping options, the auto-authorizing system payment provider, and a
 * completed order.
 *
 * ## The tier is the instrument
 *
 * Variant A is 35 000 at walk-up and 28 000 from 20 units (see the fixture).
 * The mint freezes the LIVE price, so on a flat-priced product the quoted
 * amount would equal the base amount and every assertion here would pass
 * whether the price list applied or not. With a tier, 28 000 in a cart of 5 is
 * a number only the quote can explain.
 *
 * ## What the "customer drops items" cases are really testing
 *
 * The minted price is an **override with no quantity bound**. That is a
 * deliberate design consequence worth pinning: a buyer quoted 25 units at the
 * volume price keeps that price at ANY quantity for as long as the quote
 * lives. See the two `drops` cases — they are written as documentation of the
 * exposure, not as approval of it.
 */

type Buyer = {
  email: string
  customerId: string
  headers: { headers: Record<string, string> }
}

setupSharedTestSuite(() => {
  describe("A minted quote in a real cart (#1389 S3)", () => {
    let fixture: QuoteFixture
    let adminHeaders: { headers: Record<string, string> }

    beforeAll(async () => {
      const { api, getContainer } = getSharedTestEnv()
      await createAdminUser(getContainer())
      adminHeaders = await getAuthHeaders(api)
      fixture = await setupQuoteFixture(api, getContainer)
    })

    /**
     * A storefront account for the buyer, linked to the partner's store.
     *
     * 🔑 The link matters: `resolveQuoteBuyerStep` looks the buyer up among the
     * store's OWN customers (deliberately — another partner's customer with the
     * same email is not this partner's buyer). An unlinked account with the
     * same email is invisible to the mint, which would then create a SECOND
     * customer and hand the group — and the prices — to the account the
     * shopper is not logged into.
     */
    const createBuyer = async (label: string): Promise<Buyer> => {
      const { api, getContainer } = getSharedTestEnv()
      const email = `buyer-${label}-${fixture.unique}@jaalyantra.test`
      const storeHeaders = { "x-publishable-api-key": fixture.publishableKey }

      const reg = await api.post(
        "/auth/customer/emailpass/register",
        { email, password: BUYER_PASSWORD },
        { headers: storeHeaders }
      )
      const created = await loud("create-customer", () =>
        api.post(
          "/store/customers",
          { email, first_name: "Buyer", last_name: label },
          {
            headers: {
              ...storeHeaders,
              Authorization: `Bearer ${reg.data.token}`,
            },
          }
        )
      )
      const customerId = created.data.customer.id

      const login = await api.post(
        "/auth/customer/emailpass",
        { email, password: BUYER_PASSWORD },
        { headers: storeHeaders }
      )

      const link: any = getContainer().resolve("link")
      await link
        .create({
          [Modules.STORE]: { store_id: fixture.storeId },
          [Modules.CUSTOMER]: { customer_id: customerId },
        })
        .catch(() => {})

      return {
        email,
        customerId,
        headers: {
          headers: {
            ...storeHeaders,
            Authorization: `Bearer ${login.data.token}`,
          },
        },
      }
    }

    const mintFor = async (buyer: Buyer, overrides: Record<string, any> = {}) => {
      const { api } = getSharedTestEnv()
      const res = await loud("mint", () =>
        api.post(
          "/partners/quotes",
          mintBody(fixture, { buyer_email: buyer.email, ...overrides }),
          { headers: fixture.headers }
        )
      )
      expect(res.status).toBe(201)
      return res.data.quote
    }

    /** A cart owned by `buyer`, holding exactly `items`. */
    const cartWith = async (
      buyer: Buyer | null,
      items: Array<{ variant_id: string; quantity: number }>
    ) => {
      const { api } = getSharedTestEnv()
      const headers = buyer?.headers ?? {
        headers: { "x-publishable-api-key": fixture.publishableKey },
      }
      const cartRes = await loud("cart-create", () =>
        api.post(
          "/store/carts",
          {
            region_id: fixture.regionId,
            sales_channel_id: fixture.salesChannelId,
            email: buyer?.email ?? `walkup-${fixture.unique}@jaalyantra.test`,
          },
          headers
        )
      )
      let cart = cartRes.data.cart
      for (const item of items) {
        const res = await loud("add-line", () =>
          api.post(`/store/carts/${cart.id}/line-items`, item, headers)
        )
        cart = res.data.cart
      }
      return cart
    }

    const unitPriceOf = (cart: any, variantId: string) => {
      const item = (cart.items ?? []).find((i: any) => i.variant_id === variantId)
      expect(item).toBeTruthy()
      return Number(item.unit_price)
    }

    // ---------------------------------------------------------------------
    describe("the quoted price reaches the cart", () => {
      it("reuses the storefront account the buyer already has, rather than minting a second one", async () => {
        const buyer = await createBuyer("cart")
        const quote = await mintFor(buyer)
        // If this ever fails, the prices are handed to an account nobody logs
        // into, and every pricing assertion in this file becomes meaningless.
        expect(quote.customer_id).toBe(buyer.customerId)
      })

      it("charges the quoted amount for the quoted basket", async () => {
        const buyer = await createBuyer("basket")
        const quote = await mintFor(buyer)

        const cart = await cartWith(buyer, [
          { variant_id: fixture.variantA.id, quantity: 25 },
          { variant_id: fixture.variantB.id, quantity: 4 },
        ])

        expect(unitPriceOf(cart, fixture.variantA.id)).toBe(VARIANT_A_TIER_PRICE)
        expect(unitPriceOf(cart, fixture.variantB.id)).toBe(VARIANT_B_PRICE)

        // The quote said this; the cart charges it. ⚠️ On its own this cannot
        // tell a working quote from a no-op — at the quoted quantity the base
        // tier is the same number. The risen-market tests below are what
        // actually prove the price list applies.
        expect(Number(cart.item_subtotal)).toBe(Number(quote.quoted_subtotal))
      })

      it("does NOT price a variant the quote never covered", async () => {
        const buyer = await createBuyer("solo")
        await mintFor(buyer, {
          lines: [{ variant_id: fixture.variantA.id, quantity: 25 }],
        })
        const cart = await cartWith(buyer, [
          { variant_id: fixture.variantB.id, quantity: 2 },
        ])
        expect(unitPriceOf(cart, fixture.variantB.id)).toBe(VARIANT_B_PRICE)
      })
    })

    // ---------------------------------------------------------------------
    /**
     * 🔑 The instrument, and the harness rule that shapes every test below.
     *
     * The mint freezes the LIVE price, so at the quoted quantity the quoted
     * amount and the base tier are the SAME number — an assertion that the cart
     * charges it passes whether the price list applies or not. Raising the base
     * price after the mint separates them, and it is what a quote is FOR: the
     * price moved and the buyer still gets what they were promised.
     *
     * ⚠️ The raise must happen INSIDE the test that asserts on it.
     * `medusaIntegrationTestRunner` snapshots the database and RESTORES it
     * before every test, so anything written by a previous test — or by a
     * nested `beforeAll`, which runs after the snapshot is taken — is rolled
     * back. A buyer created in a nested `beforeAll` does not exist by the time
     * the test runs, and its cart 404s with "Customer ... was not found".
     *
     * 🔴 Raise BOTH prices. Core picks the CHEAPEST applicable price among
     * equals, so leaving the un-tiered base at 35 000 while lifting the tier to
     * 45 000 just makes 35 000 win, and the "market" never actually moved.
     */
    const RAISED_BASE = 90000
    const RAISED_TIER = 80000

    const raiseTheMarket = async () => {
      const { api } = getSharedTestEnv()
      await loud("raise-price", () =>
        api.post(
          `/admin/products/${fixture.productId}/variants/${fixture.variantA.id}`,
          {
            prices: [
              { amount: RAISED_BASE, currency_code: fixture.currencyCode },
              {
                amount: RAISED_TIER,
                currency_code: fixture.currencyCode,
                min_quantity: VARIANT_A_TIER_MIN_QTY,
              },
            ],
          },
          adminHeaders
        )
      )
    }

    /** A buyer holding a live quote, with the market moved out from under it. */
    const quotedBuyerInARisenMarket = async (label: string) => {
      const buyer = await createBuyer(label)
      const quote = await mintFor(buyer)
      await raiseTheMarket()
      return { buyer, quote }
    }

    describe("the quote holds its price when the market moves", () => {
      it("charges the quoted amount after the base price rises — walk-up pays the new one", async () => {
        const { buyer } = await quotedBuyerInARisenMarket("holds")

        // The control: anyone else buying 25 today pays the new price.
        const walkUp = await cartWith(null, [
          { variant_id: fixture.variantA.id, quantity: 25 },
        ])
        expect(unitPriceOf(walkUp, fixture.variantA.id)).toBe(RAISED_TIER)

        // 🔴 The whole feature in one assertion. This is what a price list
        // ruled on `customer_group_id` instead of `customer.groups.id` fails —
        // silently, with a perfect-looking price list behind it.
        const quoted = await cartWith(buyer, [
          { variant_id: fixture.variantA.id, quantity: 25 },
        ])
        expect(unitPriceOf(quoted, fixture.variantA.id)).toBe(VARIANT_A_TIER_PRICE)
      })

      it("ordering MORE than quoted keeps the quoted unit price", async () => {
        const { buyer } = await quotedBuyerInARisenMarket("more")
        // `min_quantity` is a floor with no ceiling: a buyer quoted 25 who
        // takes 40 has earned the tier they were quoted.
        const cart = await cartWith(buyer, [
          { variant_id: fixture.variantA.id, quantity: 40 },
        ])
        expect(unitPriceOf(cart, fixture.variantA.id)).toBe(VARIANT_A_TIER_PRICE)
        expect(Number(cart.item_subtotal)).toBe(40 * VARIANT_A_TIER_PRICE)
      })

      it("a second buyer is never touched by someone else's quote", async () => {
        await quotedBuyerInARisenMarket("owner")
        const stranger = await createBuyer("stranger")
        const cart = await cartWith(stranger, [
          { variant_id: fixture.variantA.id, quantity: 25 },
        ])
        // The group rule is the whole safety property. If this ever returns the
        // quoted amount, the rule stopped scoping and every customer on the
        // platform is being quoted.
        expect(unitPriceOf(cart, fixture.variantA.id)).toBe(RAISED_TIER)
      })
    })

    // ---------------------------------------------------------------------
    describe("the buyer drops items", () => {
      it("dropping BELOW the quoted quantity falls back to the live price", async () => {
        const { buyer } = await quotedBuyerInARisenMarket("drops")
        // 🔑 By design, not by accident: `planQuotePrices` writes
        // `min_quantity = quoted quantity`, so the discount travels with the
        // volume it was given for. A buyer quoted 25 who takes 5 is a different
        // deal and pays today's price for it.
        const cart = await cartWith(buyer, [
          { variant_id: fixture.variantA.id, quantity: 5 },
        ])
        expect(unitPriceOf(cart, fixture.variantA.id)).toBe(RAISED_BASE)
        expect(unitPriceOf(cart, fixture.variantA.id)).not.toBe(VARIANT_A_TIER_PRICE)
      })

      it("dropping to just under the quoted quantity already loses the quote", async () => {
        const { buyer } = await quotedBuyerInARisenMarket("boundary")
        // The boundary, pinned: 24 of a 25-unit quote is not the quote. It
        // lands on whatever the live tier says today.
        const cart = await cartWith(buyer, [
          { variant_id: fixture.variantA.id, quantity: 24 },
        ])
        expect(unitPriceOf(cart, fixture.variantA.id)).toBe(RAISED_TIER)
      })

      it("dropping one line entirely leaves the other line quoted", async () => {
        const { buyer } = await quotedBuyerInARisenMarket("dropline")
        const cart = await cartWith(buyer, [
          { variant_id: fixture.variantA.id, quantity: 25 },
        ])
        expect(unitPriceOf(cart, fixture.variantA.id)).toBe(VARIANT_A_TIER_PRICE)
        expect((cart.items ?? []).length).toBe(1)
      })

      it("adding a variant the quote never covered prices it live", async () => {
        const { buyer } = await quotedBuyerInARisenMarket("adds")
        const cart = await cartWith(buyer, [
          { variant_id: fixture.variantA.id, quantity: 25 },
          { variant_id: fixture.variantB.id, quantity: 2 },
        ])
        // A quote is a basket, not an account-wide discount.
        expect(unitPriceOf(cart, fixture.variantA.id)).toBe(VARIANT_A_TIER_PRICE)
        expect(unitPriceOf(cart, fixture.variantB.id)).toBe(VARIANT_B_PRICE)
      })
    })

    // ---------------------------------------------------------------------
    describe("the quote's prices die with the quote", () => {
      it("an expired quote stops pricing the cart — no sweeper involved", async () => {
        const { api } = getSharedTestEnv()
        const { buyer, quote } = await quotedBuyerInARisenMarket("expiry")

        const before = await cartWith(buyer, [
          { variant_id: fixture.variantA.id, quantity: 25 },
        ])
        expect(unitPriceOf(before, fixture.variantA.id)).toBe(VARIANT_A_TIER_PRICE)

        // Expiry is native: `ends_at` IS the quote's TTL, which is why nothing
        // has to run on a cron to retire a quote's prices.
        await loud("expire", () =>
          api.post(
            `/admin/price-lists/${quote.price_list_id}`,
            { ends_at: new Date(Date.now() - 60_000).toISOString() },
            adminHeaders
          )
        )

        const after = await cartWith(buyer, [
          { variant_id: fixture.variantA.id, quantity: 25 },
        ])
        expect(unitPriceOf(after, fixture.variantA.id)).toBe(RAISED_TIER)
      })

      it("a revoked quote stops pricing the cart", async () => {
        const { api } = getSharedTestEnv()
        const { buyer, quote } = await quotedBuyerInARisenMarket("revoke")

        const before = await cartWith(buyer, [
          { variant_id: fixture.variantA.id, quantity: 25 },
        ])
        expect(unitPriceOf(before, fixture.variantA.id)).toBe(VARIANT_A_TIER_PRICE)

        // `status: draft` IS the revoke — the same reason no sweeper is needed.
        await loud("revoke", () =>
          api.post(
            `/admin/price-lists/${quote.price_list_id}`,
            { status: "draft" },
            adminHeaders
          )
        )

        const after = await cartWith(buyer, [
          { variant_id: fixture.variantA.id, quantity: 25 },
        ])
        expect(unitPriceOf(after, fixture.variantA.id)).toBe(RAISED_TIER)
      })
    })

    // ---------------------------------------------------------------------
    describe("the buyer actually checks out", () => {
      it("completes an order at the quoted prices", async () => {
        const { api } = getSharedTestEnv()
        const { buyer, quote } = await quotedBuyerInARisenMarket("checkout")

        const cart = await cartWith(buyer, [
          { variant_id: fixture.variantA.id, quantity: 25 },
          { variant_id: fixture.variantB.id, quantity: 4 },
        ])

        await loud("addresses", () =>
          api.post(
            `/store/carts/${cart.id}`,
            {
              email: buyer.email,
              shipping_address: {
                first_name: "Test",
                last_name: "Buyer",
                address_1: "9 Marine Drive",
                city: "Mumbai",
                province: "MH",
                postal_code: "400001",
                country_code: "in",
                phone: "+919000000000",
              },
              billing_address: {
                first_name: "Test",
                last_name: "Buyer",
                address_1: "9 Marine Drive",
                city: "Mumbai",
                province: "MH",
                postal_code: "400001",
                country_code: "in",
              },
            },
            buyer.headers
          )
        )

        const shippingRes = await api.get(
          `/store/shipping-options?cart_id=${cart.id}`,
          buyer.headers
        )
        const options = shippingRes.data.shipping_options ?? []
        if (!options.length) {
          throw new Error(
            `No shipping options for cart ${cart.id} — the fixture's flat option did not reach the storefront, so the freight the quote promised cannot be bought.`
          )
        }
        await loud("shipping-method", () =>
          api.post(
            `/store/carts/${cart.id}/shipping-methods`,
            { option_id: options[0].id },
            buyer.headers
          )
        )

        const payColl = await loud("payment-collection", () =>
          api.post("/store/payment-collections", { cart_id: cart.id }, buyer.headers)
        )
        const providers = (
          await api.get(
            `/store/payment-providers?region_id=${fixture.regionId}`,
            buyer.headers
          )
        ).data.payment_providers
        const provider = pickTestPaymentProvider(providers)
        expect(provider).toBeTruthy()
        await loud("payment-session", () =>
          api.post(
            `/store/payment-collections/${payColl.data.payment_collection.id}/payment-sessions`,
            { provider_id: provider!.id },
            buyer.headers
          )
        )

        const complete = await loud("complete", () =>
          api.post(`/store/carts/${cart.id}/complete`, {}, buyer.headers)
        )
        expect(complete.data.type).toBe("order")
        const order = complete.data.order

        const itemA = order.items.find(
          (i: any) => i.variant_id === fixture.variantA.id
        )
        const itemB = order.items.find(
          (i: any) => i.variant_id === fixture.variantB.id
        )
        expect(Number(itemB.unit_price)).toBe(VARIANT_B_PRICE)
        // Not a literal: earlier tests move the base price, and the point is
        // that the ORDER agrees with the QUOTE, whatever the market did.
        expect(
          Number(itemA.unit_price) * 25 + Number(itemB.unit_price) * 4
        ).toBe(Number(quote.quoted_subtotal))

        // 🔑 The quote's numbers survived all the way into a paid order.
        expect(Number(order.item_subtotal)).toBe(Number(quote.quoted_subtotal))
        expect(Number(order.shipping_subtotal)).toBe(FLAT_FREIGHT_AMOUNT)
        expect(Number(order.item_subtotal) + Number(order.shipping_subtotal)).toBe(
          Number(quote.quoted_landed_total)
        )
      })
    })
  })
})
