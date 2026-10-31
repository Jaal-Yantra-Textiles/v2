import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { mintBody, setupQuoteFixture, type QuoteFixture } from "../helpers/setup-quote-fixture"
import { pickTestPaymentProvider } from "../helpers/pick-payment-provider"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { PAYMENT_SCHEDULE_MODULE } from "../../src/modules/payment_schedule"

jest.setTimeout(300 * 1000)

/**
 * #2480 — the customer invoice after an order edit.
 *
 * The shape this exists for is order #101 (Oshen, 2026-10-31): a 30% deposit
 * paid, the balance raised, then an edit added items. The order's pending
 * difference moved; the schedule's balance did not, so the pay link would have
 * charged the old figure. The invoice route moves the schedule to the order,
 * keeps the buyer's link, and only then emails.
 */
setupSharedTestSuite(() => {
  describe("POST /admin/orders/:id/invoice", () => {
    let seed: QuoteFixture
    let adminHeaders: Record<string, any>
    let storeHeaders: Record<string, string>

    const container = () => getSharedTestEnv().getContainer()
    const schedules = () => container().resolve(PAYMENT_SCHEDULE_MODULE) as any

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
          html_content:
            "<div>{{#each lines}}<p>{{title}} {{quantity}} {{line_total}}</p>{{/each}}<p>{{balance_due}} {{pay_url}}</p></div>",
          from: "orders@jaalyantra.com",
          variables: { lines: "lines" },
          template_type: "order_invoice",
        },
        adminHeaders
      )
    })

    /** Mint, accept, pay and capture the deposit, complete. */
    const placedDepositOrder = async () => {
      const { api } = getSharedTestEnv()
      const minted = (
        await api.post(
          "/partners/quotes",
          mintBody(seed, {
            buyer_email: `invoice-${seed.unique}-${Date.now()}@jaalyantra.test`,
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
      const payColl = await api.post(
        "/store/payment-collections",
        { cart_id: cartId },
        { headers: storeHeaders }
      )
      const collection = payColl.data.payment_collection
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
      const complete = await api.post(`/store/carts/${cartId}/complete`, {}, {
        headers: storeHeaders,
      })
      const orderId = complete.data.order.id

      const query: any = container().resolve(ContainerRegistrationKeys.QUERY)
      const { data: paid } = await query.graph({
        entity: "order",
        fields: ["id", "payment_collections.payments.id"],
        filters: { id: orderId },
      })
      for (const pc of paid[0].payment_collections ?? []) {
        for (const p of pc.payments ?? []) {
          await api.post(`/admin/payments/${p.id}/capture`, {}, adminHeaders)
        }
      }
      for (let i = 0; i < 40; i++) {
        const s = await schedules().findByOrderId(orderId)
        if (s?.deposit_status === "paid") break
        await new Promise((r) => setTimeout(r, 250))
      }
      return orderId as string
    }

    const pendingOf = async (orderId: string) => {
      const query: any = container().resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "order",
        fields: ["id", "total", "summary"],
        filters: { id: orderId },
      })
      return {
        total: Number(data[0].total),
        pending: Number(data[0].summary?.pending_difference),
      }
    }

    it("rebills the balance to the edited order, keeps the link, then emails", async () => {
      const { api } = getSharedTestEnv()
      const orderId = await placedDepositOrder()

      const raised = await api.post(`/admin/orders/${orderId}/balance`, { confirm: true }, adminHeaders)
      expect(raised.status).toBe(200)
      const before = await schedules().findByOrderId(orderId)
      expect(before.balance_status).toBe("due")
      const link = before.balance_link_ref
      expect(link).toBeTruthy()

      // The edit after the deposit: one more piece at a stated price.
      await api.post("/admin/order-edits", { order_id: orderId }, adminHeaders)
      await api.post(
        `/admin/order-edits/${orderId}/items`,
        { items: [{ variant_id: seed.variantA.id, quantity: 1, unit_price: 100 }] },
        adminHeaders
      )
      await api.post(`/admin/order-edits/${orderId}/request`, {}, adminHeaders)
      await api.post(`/admin/order-edits/${orderId}/confirm`, {}, adminHeaders)

      const edited = await pendingOf(orderId)
      expect(Number(before.balance_amount)).not.toBeCloseTo(edited.pending, 2)

      // Preview: says what it would do, writes nothing.
      const preview = await api.post(`/admin/orders/${orderId}/invoice`, { preview: true }, adminHeaders)
      expect(preview.status).toBe(200)
      expect(preview.data.sent).toBe(false)
      expect(preview.data.resync.action).toBe("resync")
      expect(preview.data.resync.balance_amount).toBeCloseTo(edited.pending, 2)
      expect(preview.data.vars.lines.length).toBeGreaterThan(0)
      expect(Number((await schedules().findByOrderId(orderId)).balance_amount)).toBeCloseTo(
        Number(before.balance_amount),
        2
      )

      // A send without confirm is refused.
      const unconfirmed = await api
        .post(`/admin/orders/${orderId}/invoice`, {}, adminHeaders)
        .catch((e: any) => e.response)
      expect(unconfirmed.status).toBe(400)

      const sent = await api.post(`/admin/orders/${orderId}/invoice`, { confirm: true }, adminHeaders)
      expect(sent.status).toBe(200)
      expect(sent.data.sent).toBe(true)

      const after = await schedules().findByOrderId(orderId)
      expect(Number(after.balance_amount)).toBeCloseTo(edited.pending, 2)
      expect(Number(after.total_due)).toBeCloseTo(edited.total, 2)
      // The buyer's URL does not change.
      expect(after.balance_link_ref).toBe(link)

      // The outstanding collection now asks for the edited balance.
      const query: any = container().resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "order",
        fields: ["id", "payment_collections.amount", "payment_collections.status"],
        filters: { id: orderId },
      })
      const outstanding = (data[0].payment_collections ?? []).filter(
        (c: any) => c.status !== "completed"
      )
      expect(outstanding.some((c: any) => Math.abs(Number(c.amount) - edited.pending) < 0.01)).toBe(
        true
      )

      const notifications: any = container().resolve(Modules.NOTIFICATION)
      const sentMail = await notifications.listNotifications({ template: "order-invoice" })
      expect(sentMail.length).toBeGreaterThan(0)
    })
  })
})
