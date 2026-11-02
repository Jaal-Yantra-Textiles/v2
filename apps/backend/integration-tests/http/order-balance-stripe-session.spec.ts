import { ContainerRegistrationKeys, PaymentActions } from "@medusajs/framework/utils"
import { processPaymentWorkflow } from "@medusajs/core-flows"
import Stripe from "stripe"

import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { mintBody, setupQuoteFixture, type QuoteFixture } from "../helpers/setup-quote-fixture"
import { pickTestPaymentProvider } from "../helpers/pick-payment-provider"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { PAYMENT_SCHEDULE_MODULE } from "../../src/modules/payment_schedule"
import { reconcileBalanceForSchedule } from "../../src/lib/payments/reconcile-balance"

jest.setTimeout(300 * 1000)

/**
 * Order #101 (Oshen), against REAL Stripe test mode.
 *
 * 2026-10-18 the balance was raised and its Stripe PaymentIntent minted for
 * 220.34. 2026-10-31 an edit moved the collection to 347.36 and left the
 * PaymentIntent alone. 2026-11-02 the page said A$347.36 and Stripe charged
 * A$220.34. Only a real PaymentIntent shows what Stripe will actually charge,
 * so this talks to Stripe — and only runs with a TEST key (CI has none).
 */
const STRIPE_KEY = process.env.STRIPE_API_KEY ?? ""
const stripeIt = /^sk_test_/.test(STRIPE_KEY) ? it : it.skip

setupSharedTestSuite(() => {
  describe("balance Stripe session follows an order edit", () => {
    let seed: QuoteFixture
    let adminHeaders: Record<string, any>
    let storeHeaders: Record<string, string>

    const container = () => getSharedTestEnv().getContainer()
    const schedules = () => container().resolve(PAYMENT_SCHEDULE_MODULE) as any
    const stripe = () => new Stripe(STRIPE_KEY)

    beforeAll(async () => {
      const { api, getContainer } = getSharedTestEnv()
      await createAdminUser(getContainer())
      adminHeaders = await getAuthHeaders(api)
      seed = await setupQuoteFixture(api, getContainer)
      storeHeaders = { "x-publishable-api-key": seed.publishableKey }
      await api.post(
        "/admin/email-templates",
        {
          name: "Order Invoice",
          template_key: "order-invoice",
          subject: "Invoice for order #{{order_display_id}}",
          html_content: "<p>{{balance_due}} {{pay_url}}</p>",
          from: "orders@jaalyantra.com",
          variables: {},
          template_type: "order_invoice",
        },
        adminHeaders
      )
    })

    /** Mint, accept, pay (system provider) and capture the deposit, complete. */
    const placedDepositOrder = async () => {
      const { api } = getSharedTestEnv()
      const minted = (
        await api.post(
          "/partners/quotes",
          mintBody(seed, {
            buyer_email: `stripe-bal-${seed.unique}-${Date.now()}@jaalyantra.test`,
            deposit_pct: 30,
          }),
          { headers: seed.headers }
        )
      ).data
      const accepted = await api.post(
        `/store/b2b/quotes/${minted.token}/accept`,
        {
          shipping_address: {
            first_name: "Sunda",
            last_name: "Buyer",
            address_1: "9 Marine Drive",
            city: "Mumbai",
            province: "MH",
            postal_code: "400001",
            country_code: "in",
            phone: "+919000000000",
          },
        },
        { headers: storeHeaders }
      )
      const cartId = accepted.data.acceptance?.cart_id
      const collection = (
        await api.post("/store/payment-collections", { cart_id: cartId }, { headers: storeHeaders })
      ).data.payment_collection
      const providers = (
        await api.get(`/store/payment-providers?region_id=${seed.regionId}`, {
          headers: storeHeaders,
        })
      ).data.payment_providers
      await api.post(
        `/store/payment-collections/${collection.id}/payment-sessions`,
        { provider_id: pickTestPaymentProvider(providers)!.id },
        { headers: storeHeaders }
      )
      const orderId = (
        await api.post(`/store/carts/${cartId}/complete`, {}, { headers: storeHeaders })
      ).data.order.id

      const query: any = container().resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "order",
        fields: ["id", "payment_collections.payments.id"],
        filters: { id: orderId },
      })
      for (const pc of data[0].payment_collections ?? []) {
        for (const p of pc.payments ?? []) {
          await api.post(`/admin/payments/${p.id}/capture`, {}, adminHeaders)
        }
      }
      for (let i = 0; i < 40; i++) {
        if ((await schedules().findByOrderId(orderId))?.deposit_status === "paid") break
        await new Promise((r) => setTimeout(r, 250))
      }
      return orderId as string
    }

    /** The outstanding collection and its Stripe session, read from the DB. */
    const balanceSide = async (orderId: string) => {
      const query: any = container().resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "order",
        fields: [
          "id",
          "summary",
          "payment_collections.id",
          "payment_collections.amount",
          "payment_collections.status",
          "payment_collections.payment_sessions.id",
          "payment_collections.payment_sessions.provider_id",
          "payment_collections.payment_sessions.amount",
          "payment_collections.payment_sessions.data",
        ],
        filters: { id: orderId },
      })
      const collection = ((data[0].payment_collections ?? []) as any[]).find(
        (c) => c.status !== "completed"
      )
      const session = (collection?.payment_sessions ?? []).find((s: any) =>
        String(s.provider_id).includes("stripe")
      )
      return {
        pending: Number(data[0].summary?.pending_difference),
        collection,
        session,
      }
    }

    /** INR is a two-decimal currency: Stripe holds paise. */
    const minor = (n: number) => Math.round(n * 100)

    stripeIt("re-mints the PaymentIntent when an edit moves the balance, and the page charges the new amount", async () => {
      const { api } = getSharedTestEnv()

      // The fixture region carries only the system provider; the balance rail is Stripe.
      await api.post(
        `/admin/regions/${seed.regionId}`,
        { payment_providers: ["pp_system_default", "pp_stripe_stripe"] },
        adminHeaders
      )

      const orderId = await placedDepositOrder()
      // The fixture deals in INR, which takes the PayU rail (accept-quote).
      // Order #101 is AUD on the Stripe rail — put this deal on Stripe too.
      const sched0 = await schedules().findByOrderId(orderId)
      await schedules().updatePaymentSchedules({ id: sched0.id, rail: "stripe" })

      // 1. Balance raised BEFORE the edit: a real PaymentIntent for the old figure.
      await api.post(`/admin/orders/${orderId}/balance`, { confirm: true }, adminHeaders)
      const before = await balanceSide(orderId)
      expect(before.session).toBeTruthy()
      const oldPi = await stripe().paymentIntents.retrieve(before.session.data.id)
      expect(oldPi.amount).toBe(minor(before.pending))

      // 2. The edit, then the invoice that rebills it.
      await api.post("/admin/order-edits", { order_id: orderId }, adminHeaders)
      await api.post(
        `/admin/order-edits/${orderId}/items`,
        { items: [{ variant_id: seed.variantA.id, quantity: 1, unit_price: 100 }] },
        adminHeaders
      )
      await api.post(`/admin/order-edits/${orderId}/request`, {}, adminHeaders)
      await api.post(`/admin/order-edits/${orderId}/confirm`, {}, adminHeaders)
      const sent = await api.post(`/admin/orders/${orderId}/invoice`, { confirm: true }, adminHeaders)
      expect(sent.data.sent).toBe(true)

      const after = await balanceSide(orderId)
      expect(after.pending).toBeGreaterThan(before.pending)
      expect(Number(after.collection.amount)).toBeCloseTo(after.pending, 2)

      // 3. What Stripe will actually charge: the NEW amount, on a NEW intent.
      expect(after.session).toBeTruthy()
      expect(after.session.data.id).not.toBe(oldPi.id)
      const newPi = await stripe().paymentIntents.retrieve(after.session.data.id)
      expect(newPi.amount).toBe(minor(after.pending))

      // 4. The buyer's page mounts that same intent.
      const schedule = await schedules().findByOrderId(orderId)
      const page = await api.get(`/stripe/pay/balance/${schedule.id}`)
      expect(page.status).toBe(200)
      const secret = String(page.data).match(/pi_[A-Za-z0-9]+_secret_[A-Za-z0-9]+/)?.[0]
      expect(secret).toBeTruthy()
      const pagePi = await stripe().paymentIntents.retrieve(secret!.split("_secret_")[0])
      expect(pagePi.amount).toBe(minor(after.pending))

      // 5. Pay it with Stripe's test card, run the webhook's workflow, reconcile.
      const confirmed = await stripe().paymentIntents.confirm(pagePi.id, {
        payment_method: "pm_card_visa",
        return_url: "https://example.test/return",
      })
      expect(["succeeded", "requires_capture"]).toContain(confirmed.status)

      expect(confirmed.status).toBe("succeeded")
      // What Stripe's `payment_intent.succeeded` webhook runs — the path that
      // writes the order's transaction, so the order's books move too.
      await processPaymentWorkflow(container()).run({
        input: {
          action: PaymentActions.SUCCESSFUL,
          data: { session_id: after.session.id, amount: after.pending },
        } as any,
      })

      const settled = await reconcileBalanceForSchedule(container(), schedule.id)
      expect(settled.marked_paid).toBe(true)
      expect((await balanceSide(orderId)).pending).toBeCloseTo(0, 2)
    })
  })
})
