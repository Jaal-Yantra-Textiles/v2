import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { createAdminUser } from "../helpers/create-admin-user"
import {
  mintBody,
  setupQuoteFixture,
  type QuoteFixture,
} from "../helpers/setup-quote-fixture"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { PAYMENT_SCHEDULE_MODULE } from "../../src/modules/payment_schedule"
import {
  ensureCartPaymentCollection,
  refreshCartPaymentCollection,
} from "../../src/lib/payments/ensure-cart-collection"

jest.setTimeout(240 * 1000)

/**
 * The buyer is charged the DEPOSIT, not the total (#1451) — against a real
 * container, a real accepted cart and the real payment module.
 *
 * ## Why the unit tests were not enough
 *
 * `deposit-collection.unit.spec.ts` proves the arithmetic and
 * `ensure-cart-collection.unit.spec.ts` proves the branching, but both STUB the
 * payment module, the link service and core's workflows. Everything they assert
 * would still pass if `createPaymentCollections` rejected the amount, if the
 * cart↔collection link never materialised, or if the schedule the seam looks up
 * were not the one acceptance actually wrote.
 *
 * That gap is exactly where this feature's history lives: acceptance itself
 * shipped, was believed done, and had never once worked, because nothing
 * exercised the real route (see `partner-quote-accept.spec.ts`).
 *
 * So this drives the real thing: mint → accept → read the schedule acceptance
 * wrote → create the collection through the seam → read the amount back out of
 * the payment module.
 */
setupSharedTestSuite(() => {
  describe("deposit collection on an accepted quote (#1451)", () => {
    let seed: QuoteFixture
    let storeHeaders: Record<string, string>

    const container = () => getSharedTestEnv().getContainer()

    beforeAll(async () => {
      const { api, getContainer } = getSharedTestEnv()
      await createAdminUser(getContainer())
      seed = await setupQuoteFixture(api, getContainer)
      storeHeaders = { "x-publishable-api-key": seed.publishableKey }
    })

    /** Mint a quote and accept it, returning the cart and its schedule. */
    const acceptedCart = async () => {
      const { api } = getSharedTestEnv()
      const minted = (
        await api.post(
          "/partners/quotes",
          mintBody(seed, {
            buyer_email: `deposit-${seed.unique}-${Date.now()}@jaalyantra.test`,
          }),
          { headers: seed.headers }
        )
      ).data

      const accepted = await api.post(
        `/store/b2b/quotes/${minted.token}/accept`,
        {},
        { headers: storeHeaders }
      )
      expect(accepted.status).toBe(201)

      const cartId = accepted.data.acceptance?.cart_id
      expect(cartId).toBeTruthy()

      const schedules: any = container().resolve(PAYMENT_SCHEDULE_MODULE)
      const schedule = await schedules.findByCartId(cartId)
      expect(schedule).toBeTruthy()

      return { cartId, schedule }
    }

    const readCart = async (cartId: string) => {
      const query: any = container().resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "cart",
        fields: [
          "id",
          "total",
          "currency_code",
          "payment_collection.id",
          "payment_collection.amount",
          "payment_collection.payment_sessions.id",
        ],
        filters: { id: cartId },
      })
      return (data ?? [])[0]
    }

    it("🔴 creates the payment collection at the DEPOSIT amount, not the cart total", async () => {
      const { cartId, schedule } = await acceptedCart()
      const before = await readCart(cartId)

      // The premise. If acceptance ever starts opening a schedule whose deposit
      // equals the total, this test would pass while proving nothing.
      const deposit = Number(schedule.deposit_amount)
      const total = Number(before.total)
      expect(deposit).toBeGreaterThan(0)
      expect(deposit).toBeLessThan(total)

      const { id, plan } = await ensureCartPaymentCollection(
        container(),
        before as any
      )
      expect(plan.basis).toBe("deposit")

      /**
       * 🔴 Read back through the CART, not the return value. The seam could
       * report a deposit it never persisted, or persist a collection it never
       * linked — and an unlinked collection means the next request silently
       * creates a second one.
       */
      const after = await readCart(cartId)
      expect(after.payment_collection?.id).toBe(id)
      expect(Number(after.payment_collection?.amount)).toBeCloseTo(deposit, 2)
      // The whole defect, stated as a number.
      expect(Number(after.payment_collection?.amount)).not.toBeCloseTo(total, 2)
    })

    it("is idempotent — a second call reuses the deposit collection rather than making another", async () => {
      const { cartId } = await acceptedCart()

      const first = await ensureCartPaymentCollection(
        container(),
        (await readCart(cartId)) as any
      )
      const second = await ensureCartPaymentCollection(
        container(),
        (await readCart(cartId)) as any
      )

      expect(second.id).toBe(first.id)
    })

    it("🔴 a refresh does NOT reset the deposit to the cart total", async () => {
      /**
       * The trap. Core's `refreshPaymentCollectionForCartWorkflow` resets the
       * collection to `cart.raw_total` whenever the two differ — which a
       * deposit does by definition — and the PayU rail refreshes on five paths.
       * Without the guard the first attempt charges the deposit and every retry
       * charges 100%.
       */
      const { cartId, schedule } = await acceptedCart()
      const deposit = Number(schedule.deposit_amount)

      await ensureCartPaymentCollection(container(), (await readCart(cartId)) as any)

      const { preserved_deposit } = await refreshCartPaymentCollection(
        container(),
        (await readCart(cartId)) as any
      )
      expect(preserved_deposit).toBe(true)

      const after = await readCart(cartId)
      expect(Number(after.payment_collection?.amount)).toBeCloseTo(deposit, 2)
      expect(Number(after.payment_collection?.amount)).not.toBeCloseTo(
        Number(after.total),
        2
      )
    })
  })
})
