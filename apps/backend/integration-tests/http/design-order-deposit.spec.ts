import { createTaxRegionsWorkflow } from "@medusajs/medusa/core-flows"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { IRegionModuleService } from "@medusajs/types"

import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import {
  createTestCustomer,
  getCustomerAuthHeaders,
  getTestCustomerCredentials,
} from "../helpers/create-customer"
import { setupCheckoutInfrastructure } from "../helpers/setup-checkout-infrastructure"
import { DESIGN_MODULE } from "../../src/modules/designs"

jest.setTimeout(120 * 1000)

/**
 * POST /admin/designs/orders/:lineItemId/deposit
 *
 * A design order takes a deposit through its SAME checkout link: the payment
 * collection checkout creates is for the deposit, not the total, and the
 * storefront is told the split. From Cherry's 10 aprons (2026-10-27), which had
 * no way to take 10% down.
 *
 * Everything runs in ONE `it`: the shared test runner resets the customer
 * publishable-key session AND cart data between `it` blocks, so all store-side
 * fixtures must be built and consumed within a single test (same constraint as
 * design-to-order-e2e.spec.ts).
 */
setupSharedTestSuite(() => {
  describe("POST /admin/designs/orders/:lineItemId/deposit", () => {
    let adminHeaders: { headers: Record<string, string> }
    let customerHeaders: { headers: Record<string, string> }
    let designId: string
    let regionId: string

    const { api, getContainer } = getSharedTestEnv()

    // Build a fresh design order (cart → design line item → address); returns
    // its line_item_id. Uses the suite's single customer/key session.
    const addAddress = async (cartId: string) => {
      const credentials = getTestCustomerCredentials()
      await api.post(
        `/store/carts/${cartId}`,
        {
          email: credentials.email,
          shipping_address: {
            first_name: "Test",
            last_name: "Customer",
            address_1: "123 Main St",
            city: "New York",
            postal_code: "10001",
            country_code: "us",
          },
        },
        customerHeaders
      )
    }

    const buildDesignOrder = async (
      opts: { withAddress?: boolean } = {}
    ): Promise<{ lineItemId: string; cartId: string }> => {
      const cartRes = await api.post(
        "/store/carts",
        { region_id: regionId },
        customerHeaders
      )
      const cartId = cartRes.data.cart.id

      const checkoutRes = await api.post(
        `/store/custom/designs/${designId}/checkout`,
        { cart_id: cartId, currency_code: "usd" },
        customerHeaders
      )
      expect(checkoutRes.status).toBe(200)
      const lineItemId = checkoutRes.data.line_item_id
      expect(lineItemId).toBeDefined()

      if (opts.withAddress !== false) {
        await addAddress(cartId)
      }
      return { lineItemId, cartId }
    }

    beforeAll(async () => {
      const container = getContainer()

      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)

      const regionsRes = await api.get("/admin/regions", adminHeaders)
      if (regionsRes.data.regions?.length > 0) {
        regionId = regionsRes.data.regions[0].id
      } else {
        const regionService = container.resolve(
          Modules.REGION
        ) as IRegionModuleService
        const region = await regionService.createRegions({
          name: "Deposit Test Region",
          currency_code: "usd",
          countries: ["us"],
        })
        regionId = region.id
      }

      const designRes = await api.post(
        "/admin/designs",
        {
          name: `Deposit Design ${Date.now()}`,
          description: "deposit test",
          design_type: "Original",
          status: "Commerce_Ready",
          priority: "Medium",
          estimated_cost: 250,
        },
        adminHeaders
      )
      designId = designRes.data.design.id
      await setupCheckoutInfrastructure(container, regionId)

      // #2328 — the region must charge tax, or a capture of the PRE-tax total
      // is indistinguishable from the right one. 5% like Indian GST on textiles.
      const tax: any = container.resolve(Modules.TAX)
      const existingTax = await tax.listTaxRegions({ country_code: "us" })
      if (!existingTax.length) {
        await createTaxRegionsWorkflow(container).run({
          input: [
            {
              country_code: "us",
              provider_id: "tp_system",
              default_tax_rate: { name: "Test GST", code: "TEST-GST", rate: 5 },
            } as any,
          ],
        })
      }

      const { customer } = await createTestCustomer(container)
      customerHeaders = await getCustomerAuthHeaders()
      const remoteLink = container.resolve(
        ContainerRegistrationKeys.LINK
      ) as any
      await remoteLink
        .create({
          [DESIGN_MODULE]: { design_id: designId },
          [Modules.CUSTOMER]: { customer_id: customer.id },
        })
        .catch(() => {})
    })

    it("collects the deposit, not the total, and refuses what would break it", async () => {
      const deposit = (lineItemId: string, body: Record<string, unknown>) =>
        api
          .post(`/admin/designs/orders/${lineItemId}/deposit`, body, adminHeaders)
          .catch((e: any) => e.response)
      const collect = async (cartId: string) =>
        (await api.post("/store/payment-collections", { cart_id: cartId }, customerHeaders))
          .data.payment_collection
      const terms = async (cartId: string) =>
        (await api.get(`/store/carts/${cartId}/quote-terms`, customerHeaders)).data.quote_terms

      // ── A fresh design order takes a 10% deposit ──────────────────────────
      const a = await buildDesignOrder()
      // Before a deposit the cart is an ordinary one, and says so.
      expect((await terms(a.cartId)).is_quote_cart).toBe(false)
      const total = Number(
        (await api.get(`/store/carts/${a.cartId}`, customerHeaders)).data.cart.total
      )
      expect(total).toBeGreaterThan(0)

      const bad = await deposit(a.lineItemId, { deposit_pct: 0 })
      expect(bad.status).toBe(400)
      expect(bad.data.reason).toBe("not_a_pct")

      const set = await deposit(a.lineItemId, { deposit_pct: 10 })
      expect(set.status).toBe(200)
      const d = set.data.design_order_deposit
      expect(d.deposit_pct).toBe(10)
      expect(d.total_due).toBeCloseTo(total, 2)
      expect(d.deposit_amount).toBeCloseTo(total * 0.1, 2)
      expect(d.deposit_amount + d.balance_amount).toBeCloseTo(total, 2)
      expect(d.balance_trigger).toBe("manual")
      expect(d.cleared_payment_collection_id).toBeNull()

      // Checkout charges the deposit, and the storefront is told so.
      expect(Number((await collect(a.cartId)).amount)).toBeCloseTo(d.deposit_amount, 2)
      const t = await terms(a.cartId)
      expect(t.is_quote_cart).toBe(true)
      expect(t.deposit_due_now).toBeCloseTo(d.deposit_amount, 2)
      expect(t.balance_due_later).toBeCloseTo(d.balance_amount, 2)

      // One schedule per cart.
      const again = await deposit(a.lineItemId, { deposit_pct: 20 })
      expect(again.status).toBe(409)
      expect(again.data.reason).toBe("already_has_deposit")

      /**
       * #2566 changed the rule this used to pin ("the price is frozen under a
       * deposit", 409 has_deposit): an UNPAID PERCENTAGE deposit has nothing
       * to protect, so a reprice re-splits it on the new total and the buyer
       * is asked for 10% of the right number. That is the money-safe choice —
       * nothing was paid, the stale collection is cleared, and the deposit
       * keeps its agreed percentage. A paid, quote or fixed-amount deposit
       * still refuses (`depositBlocksEdit`, unit-tested). #2645 fixed this
       * stale expectation.
       */
      const reprice = await api
        .post(`/admin/designs/orders/${a.lineItemId}/reprice`, { unit_price: 999 }, adminHeaders)
        .catch((e: any) => e.response)
      expect(reprice.status).toBe(200)
      const r = reprice.data.design_order_reprice
      expect(r.deposit.deposit_pct).toBe(10)
      expect(r.deposit.deposit_amount).toBeCloseTo(Math.round(Number(r.total) * 10) / 100, 2)
      expect(r.deposit.deposit_amount + r.deposit.balance_amount).toBeCloseTo(Number(r.total), 2)
      // The old-deposit collection was cleared; checkout's next one is the new deposit.
      expect(Number((await collect(a.cartId)).amount)).toBeCloseTo(r.deposit.deposit_amount, 2)

      // A FIXED deposit still freezes the price.
      const f = await buildDesignOrder()
      expect((await deposit(f.lineItemId, { deposit_amount: 1 })).status).toBe(200)
      const frozen = await api
        .post(`/admin/designs/orders/${f.lineItemId}/reprice`, { unit_price: 999 }, adminHeaders)
        .catch((e: any) => e.response)
      expect(frozen.status).toBe(409)
      expect(frozen.data.reason).toBe("has_deposit")

      // ── A buyer who already opened checkout: the full-total collection ────
      // is cleared so the next checkout makes the deposit one.
      const b = await buildDesignOrder()
      const stale = await collect(b.cartId)
      const setB = await deposit(b.lineItemId, { deposit_pct: 25, balance_trigger: "dispatch" })
      expect(setB.status).toBe(200)
      expect(setB.data.design_order_deposit.cleared_payment_collection_id).toBe(stale.id)
      expect(setB.data.design_order_deposit.balance_trigger).toBe("dispatch")
      const fresh = await collect(b.cartId)
      expect(fresh.id).not.toBe(stale.id)
      expect(Number(fresh.amount)).toBeCloseTo(
        setB.data.design_order_deposit.deposit_amount,
        2
      )
    })

    /**
     * Cherry, 2026-10-27: the deposit was set while her cart had no address,
     * so before tax. It must follow the total the buyer actually checks out
     * at — 10% of the taxed total, not of the pre-tax one.
     */
    it("charges the percentage of the total at checkout, after tax applies", async () => {
      const cartTotal = async (cartId: string) =>
        Number((await api.get(`/store/carts/${cartId}`, customerHeaders)).data.cart.total)

      const c = await buildDesignOrder({ withAddress: false })
      const before = await cartTotal(c.cartId)
      const set = await api.post(
        `/admin/designs/orders/${c.lineItemId}/deposit`,
        { deposit_pct: 10 },
        adminHeaders
      )
      expect(set.status).toBe(200)
      expect(set.data.design_order_deposit.deposit_amount).toBeCloseTo(before * 0.1, 2)

      // The buyer gives an address; the region's 5% tax now applies.
      await addAddress(c.cartId)
      const after = await cartTotal(c.cartId)
      expect(after).toBeGreaterThan(before)

      const collection = (
        await api.post("/store/payment-collections", { cart_id: c.cartId }, customerHeaders)
      ).data.payment_collection
      expect(Number(collection.amount)).toBeCloseTo(Math.round(after * 10) / 100, 2)

      /**
       * #2645 — the rounding rule: the DEPOSIT is rounded to the cent, and the
       * balance is the remainder (total − deposit, to the cent), never a second
       * percentage. A taxed total can carry sub-cent precision (287.049): 10%
       * rounds to 28.70 and the balance is 258.35, while "90% of the total"
       * would be 258.3441 — the half-cent this assertion used to fail on.
       * Deposit + balance must give back the total; two percentages do not.
       */
      const round2 = (n: number) => Math.round(n * 100) / 100
      const expectedDeposit = round2(after * 0.1)
      const terms = (await api.get(`/store/carts/${c.cartId}/quote-terms`, customerHeaders)).data
        .quote_terms
      expect(terms.deposit_due_now).toBeCloseTo(expectedDeposit, 2)
      expect(terms.balance_due_later).toBeCloseTo(round2(after - expectedDeposit), 2)
      expect(terms.deposit_due_now + terms.balance_due_later).toBeCloseTo(after, 2)
    })

    /**
     * Order #176, 2026-11-26: a 50% deposit charged IN FULL (195, not 97.50).
     *
     * The collection was made at the deposit, then a cart update (address,
     * shipping method, region...) made core refresh it to the full total, and
     * the SDK, seeing a collection already there, posted straight to
     * /payment-sessions. Nothing put the deposit back, so the card session
     * was opened for the total. The session route must re-align it.
     */
    it("keeps the deposit when the cart changes after the collection exists (#176)", async () => {
      const c = await buildDesignOrder()
      const set = await api.post(
        `/admin/designs/orders/${c.lineItemId}/deposit`,
        { deposit_pct: 50 },
        adminHeaders
      )
      expect(set.status).toBe(200)

      const collection = (
        await api.post("/store/payment-collections", { cart_id: c.cartId }, customerHeaders)
      ).data.payment_collection
      const total = Number((await api.get(`/store/carts/${c.cartId}`, customerHeaders)).data.cart.total)
      expect(Number(collection.amount)).toBeCloseTo(total * 0.5, 2)

      // A checkout step that changes a tax-relevant address field: core's
      // refresh re-sets the collection to the cart total.
      await api.post(
        `/store/carts/${c.cartId}`,
        { shipping_address: { city: `Changed ${Date.now()}` } },
        customerHeaders
      )
      const query: any = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const amountNow = async () =>
        Number(
          (
            await query.graph({
              entity: "payment_collection",
              fields: ["amount"],
              filters: { id: collection.id },
            })
          ).data[0].amount
        )
      const totalAfter = Number(
        (await api.get(`/store/carts/${c.cartId}`, customerHeaders)).data.cart.total
      )
      // The premise: core really did reset it (else this test proves nothing).
      expect(await amountNow()).toBeCloseTo(totalAfter, 2)

      // The SDK path: an existing collection -> straight to payment-sessions.
      const session = await api
        .post(
          `/store/payment-collections/${collection.id}/payment-sessions`,
          { provider_id: "pp_system_default" },
          customerHeaders
        )
        .catch((e: any) => e.response)
      expect(session.status).toBe(200)

      // Read the row back: the deposit, not the total, is what gets charged.
      expect(await amountNow()).toBeCloseTo(totalAfter * 0.5, 2)
      expect(Number(session.data.payment_collection.amount)).toBeCloseTo(totalAfter * 0.5, 2)
    })

    /**
     * #2645 item 5b — a QUOTE schedule's deposit is fixed at mint, so the
     * #176 re-align does not apply to it. Core's reset-to-full-total on a cart
     * update must then make checkout REFUSE, never open a session for the
     * total. Same premise check as #176: core really reset the collection.
     */
    it("a QUOTE deposit cart refuses after core resets its collection, never charges the total", async () => {
      const c = await buildDesignOrder()
      const total = Number(
        (await api.get(`/store/carts/${c.cartId}`, customerHeaders)).data.cart.total
      )
      const schedules: any = getContainer().resolve("payment_schedule")
      await schedules.openForCart({
        cart_id: c.cartId,
        currency_code: "usd",
        total_due: total,
        source_type: "quote",
        rail: "stripe",
        quote_deposit_pct: 30,
      })
      const deposit = Math.round(total * 30) / 100

      const collection = (
        await api.post("/store/payment-collections", { cart_id: c.cartId }, customerHeaders)
      ).data.payment_collection
      expect(Number(collection.amount)).toBeCloseTo(deposit, 2)

      await api.post(
        `/store/carts/${c.cartId}`,
        { shipping_address: { city: `Quote ${Date.now()}` } },
        customerHeaders
      )
      const query: any = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const readCollection = async () =>
        (
          await query.graph({
            entity: "payment_collection",
            fields: ["amount", "payment_sessions.id", "payment_sessions.amount"],
            filters: { id: collection.id },
          })
        ).data[0]
      // The premise: core reset the quote cart's collection to the (new) total.
      const totalAfter = Number(
        (await api.get(`/store/carts/${c.cartId}`, customerHeaders)).data.cart.total
      )
      expect(Number((await readCollection()).amount)).toBeCloseTo(totalAfter, 2)
      expect(totalAfter).not.toBeCloseTo(deposit, 2)

      const session = await api
        .post(
          `/store/payment-collections/${collection.id}/payment-sessions`,
          { provider_id: "pp_system_default" },
          customerHeaders
        )
        .catch((e: any) => e.response)
      // Refused, loudly — and no session exists for the full total.
      expect(session.status).toBeGreaterThanOrEqual(400)
      expect(JSON.stringify(session.data)).toMatch(/payment schedule says/)
      const after = await readCollection()
      expect(
        (after.payment_sessions ?? []).filter(
          (s: any) => Math.round(Number(s.amount) * 100) === Math.round(totalAfter * 100)
        )
      ).toHaveLength(0)
    })
  })
})
