import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { createAdminUser } from "../helpers/create-admin-user"
import {
  mintBody,
  setupQuoteFixture,
  type QuoteFixture,
} from "../helpers/setup-quote-fixture"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { PARTNER_QUOTE_MODULE } from "../../src/modules/partner-quote"

jest.setTimeout(240 * 1000)

/**
 * The buyer accepts (#1439 S11) — through the real route.
 *
 * ## Why this file exists
 *
 * Acceptance shipped, was believed done, and had **never once worked**. Three
 * defects stacked on the same path and every one of them was invisible to the
 * suite, because nothing exercised `POST /store/b2b/quotes/:token/accept`.
 * `partner-quote-cart-pricing.spec.ts` builds its carts directly, so it proves
 * the price list works and says nothing about whether a buyer can reach it.
 *
 * 1. **A `Date` between two steps arrives as an ISO string.** Step input AND
 *    output are serialized, so `quoteUnusableReason` threw on every call. tsc
 *    cannot see it: step types describe the workflow GRAPH, not the payload.
 * 2. **The freight option was hidden from the cart that earned it.** Its rule
 *    is `quote_id`, resolved by `accepted_cart_id`, which was written LAST —
 *    after the option had to be visible.
 * 3. **The context hook returned a plain object instead of a `StepResponse`.**
 *    A hook runs as a step, so `getResult()` gave `undefined`, and
 *    `isContextValid` compared the literal string `"undefined"` against the
 *    rule. The hook logged the correct quote id on its way to discarding it.
 *
 * 🔑 All three produce the same two symptoms — a 500, then
 * "Shipping Options are invalid for cart" — and none is visible to a unit test
 * or to a type checker. Only a real POST against a real container finds them.
 */

setupSharedTestSuite(() => {
  describe("POST /store/b2b/quotes/:token/accept (#1439 S11)", () => {
    let seed: QuoteFixture
    let storeHeaders: Record<string, string>

    const container = () => getSharedTestEnv().getContainer()

    beforeAll(async () => {
      const { api, getContainer } = getSharedTestEnv()
      await createAdminUser(getContainer())
      seed = await setupQuoteFixture(api, getContainer)
      storeHeaders = { "x-publishable-api-key": seed.publishableKey }
    })

    const mint = async (overrides: Record<string, any> = {}) => {
      const { api } = getSharedTestEnv()
      const res = await api.post("/partners/quotes", mintBody(seed, overrides), {
        headers: seed.headers,
      })
      return res.data
    }

    const readCart = async (cartId: string) => {
      const query: any = container().resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "cart",
        fields: [
          "id",
          "customer_id",
          "currency_code",
          "items.id",
          "items.variant_id",
          "items.quantity",
          "items.unit_price",
          "shipping_methods.id",
          "shipping_methods.amount",
          "shipping_methods.name",
        ],
        filters: { id: cartId },
      })
      return (data ?? [])[0]
    }

    it("🔴 accepts into a cart that carries the quoted freight", async () => {
      const minted = await mint({
        buyer_email: `accept-${seed.unique}@jaalyantra.test`,
      })

      const res = await getSharedTestEnv().api.post(
        `/store/b2b/quotes/${minted.token}/accept`,
        {},
        { headers: storeHeaders }
      )

      expect(res.status).toBe(201)
      const cartId = res.data.acceptance?.cart_id
      expect(cartId).toBeTruthy()
      expect(res.data.acceptance?.schedule_id).toBeTruthy()
      expect(res.data.acceptance?.already_accepted).toBe(false)

      const cart = await readCart(cartId)
      // 🔑 THE assertion. The freight method only exists if the minted option
      // was visible to this cart — which is defects 2 and 3 in one line.
      expect((cart?.shipping_methods ?? []).length).toBe(1)
      expect(String(cart.shipping_methods[0].name)).toContain("Quoted freight")
      expect(Number(cart.shipping_methods[0].amount)).toBeGreaterThan(0)

      // Bound to the quote's own customer server-side, so the price list rules.
      expect(cart.customer_id).toBe(minted.quote.customer_id)
      expect((cart.items ?? []).length).toBeGreaterThan(0)
    })

    it("is idempotent — a double click is not a second deal", async () => {
      const minted = await mint({
        buyer_email: `idem-${seed.unique}@jaalyantra.test`,
      })
      const { api } = getSharedTestEnv()

      const first = await api.post(
        `/store/b2b/quotes/${minted.token}/accept`,
        {},
        { headers: storeHeaders }
      )
      const second = await api.post(
        `/store/b2b/quotes/${minted.token}/accept`,
        {},
        { headers: storeHeaders }
      )

      expect(second.data.acceptance.cart_id).toBe(first.data.acceptance.cart_id)
      expect(second.data.acceptance.already_accepted).toBe(true)
    })

    /**
     * 🔑 BOTH, deliberately. `accepted_cart_id` is written early so the freight
     * option can be seen by the cart that earned it; `accepted_at` marks
     * completion; and idempotency needs both — otherwise a half-finished run
     * reports itself accepted and hands the buyer a cart with no freight.
     */
    it("records both facts on a completed acceptance", async () => {
      const minted = await mint({
        buyer_email: `marks-${seed.unique}@jaalyantra.test`,
      })
      await getSharedTestEnv().api.post(
        `/store/b2b/quotes/${minted.token}/accept`,
        {},
        { headers: storeHeaders }
      )

      const service: any = container().resolve(PARTNER_QUOTE_MODULE)
      const row = await service.retrievePartnerQuote(minted.quote.id)

      expect(row.accepted_cart_id).toBeTruthy()
      expect(row.accepted_at).toBeTruthy()
    })

    /**
     * The buyer's dial has to survive acceptance (#1439 S13).
     *
     * 🔴 The page has let a buyer move quantities since #1389 — `?lines=`
     * re-prices the whole view — while acceptance built the cart from the
     * QUOTED quantities and said nothing. A buyer who dialled up, watched the
     * total rise, and pressed accept got a cart for the original amount. Both
     * numbers were "correct"; they were answers to different questions.
     */
    it("🔴 builds the cart from the quantities the buyer dialled", async () => {
      const minted = await mint({
        buyer_email: `dial-${seed.unique}@jaalyantra.test`,
      })
      // From the fixture's own basket — the mint response does not embed lines.
      const variantId = seed.variantA.id
      const quotedQty = 25
      const dialled = quotedQty + 3

      const res = await getSharedTestEnv().api.post(
        `/store/b2b/quotes/${minted.token}/accept`,
        { lines: [{ variant_id: variantId, quantity: dialled }] },
        { headers: storeHeaders }
      )

      expect(res.status).toBe(201)
      const cart = await readCart(res.data.acceptance.cart_id)

      const line = (cart.items ?? []).find(
        (i: any) => i.variant_id === variantId
      )
      // THE assertion: the cart holds what the buyer asked for, not what the
      // quote was minted with.
      expect(Number(line?.quantity)).toBe(dialled)
      expect(Number(line?.quantity)).not.toBe(quotedQty)
    })

    /**
     * 🔑 The dial is a quantity control, never a way into the catalogue. The
     * minted price list is scoped to this buyer and priced for THIS basket, so
     * a variant nobody quoted has no frozen price to stand behind — it would be
     * sold at whatever the catalogue says, which is a price this buyer was
     * never offered.
     */
    it("refuses a variant that was never quoted", async () => {
      const minted = await mint({
        buyer_email: `dial-foreign-${seed.unique}@jaalyantra.test`,
      })

      const err = await getSharedTestEnv()
        .api.post(
          `/store/b2b/quotes/${minted.token}/accept`,
          { lines: [{ variant_id: "variant_not_on_this_quote", quantity: 5 }] },
          { headers: storeHeaders }
        )
        .catch((e: any) => e.response)

      expect(err.status).toBe(400)
      expect(String(err.data?.message)).toContain("not on this quote")
    })

    it("still accepts the quoted basket when no dial is sent", async () => {
      const minted = await mint({
        buyer_email: `dial-absent-${seed.unique}@jaalyantra.test`,
      })
      const res = await getSharedTestEnv().api.post(
        `/store/b2b/quotes/${minted.token}/accept`,
        {},
        { headers: storeHeaders }
      )

      expect(res.status).toBe(201)
      const cart = await readCart(res.data.acceptance.cart_id)
      const line = (cart.items ?? []).find(
        (i: any) => i.variant_id === seed.variantA.id
      )
      expect(Number(line?.quantity)).toBe(25)
    })

    it("404s an unknown token, indistinguishably from a revoked one", async () => {
      const err = await getSharedTestEnv()
        .api.post(
          "/store/b2b/quotes/not-a-real-token/accept",
          {},
          { headers: storeHeaders }
        )
        .catch((e: any) => e.response)

      expect(err.status).toBe(404)
    })
  })
})
