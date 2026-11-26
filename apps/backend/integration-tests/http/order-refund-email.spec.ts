import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { mintBody, setupQuoteFixture, type QuoteFixture } from "../helpers/setup-quote-fixture"
import { pickTestPaymentProvider } from "../helpers/pick-payment-provider"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { PAYMENT_SCHEDULE_MODULE } from "../../src/modules/payment_schedule"
import {
  ORDER_REFUNDED_FROM,
  ORDER_REFUNDED_HTML,
  ORDER_REFUNDED_SUBJECT,
} from "../../src/lib/payments/order-refunded-template"

jest.setTimeout(300 * 1000)

/**
 * #2645 — the buyer is told about a refund.
 *
 * A deposit order is placed and its deposit captured; part of it is refunded
 * through core's refund route (which emits `payment.refunded`). The subscriber
 * emails the buyer once and stamps the refund id; the admin route previews the
 * email with a note and sends nothing.
 */
setupSharedTestSuite(() => {
  describe("refund email", () => {
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
          name: "Order Refunded",
          template_key: "order-refunded",
          subject: ORDER_REFUNDED_SUBJECT,
          html_content: ORDER_REFUNDED_HTML,
          from: ORDER_REFUNDED_FROM,
          variables: { refund_amount: "refund" },
          template_type: "transactional",
        },
        adminHeaders
      )
    })

    const placedDepositOrder = async () => {
      const { api } = getSharedTestEnv()
      const minted = (
        await api.post(
          "/partners/quotes",
          mintBody(seed, {
            buyer_email: `refund-${seed.unique}-${Date.now()}@jaalyantra.test`,
            deposit_pct: 30,
          }),
          { headers: seed.headers }
        )
      ).data
      const accepted = await api.post(
        `/store/b2b/quotes/${minted.token}/accept`,
        {
          shipping_address: {
            first_name: "Rune",
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
      const orderId = complete.data.order.id as string

      const query: any = container().resolve(ContainerRegistrationKeys.QUERY)
      const { data: paid } = await query.graph({
        entity: "order",
        fields: ["id", "payment_collections.payments.id", "payment_collections.payments.amount"],
        filters: { id: orderId },
      })
      const payments = (paid[0].payment_collections ?? []).flatMap((c: any) => c.payments ?? [])
      for (const p of payments) {
        await api.post(`/admin/payments/${p.id}/capture`, {}, adminHeaders)
      }
      for (let i = 0; i < 40; i++) {
        const s = await schedules().findByOrderId(orderId)
        if (s?.deposit_status === "paid") break
        await new Promise((r) => setTimeout(r, 250))
      }
      return { orderId, payment: payments[0] }
    }

    const orderMetadata = async (orderId: string) => {
      const query: any = container().resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "order",
        fields: ["id", "metadata"],
        filters: { id: orderId },
      })
      return data[0]?.metadata ?? {}
    }

    it("emails once on refund, and previews a note without sending", async () => {
      const { api } = getSharedTestEnv()
      const { orderId, payment } = await placedDepositOrder()
      const deposit = Number(payment.amount)
      const refund = Math.round(deposit * 0.5 * 100) / 100

      const refunded = await api.post(
        `/admin/payments/${payment.id}/refund`,
        { amount: refund },
        adminHeaders
      )
      expect(refunded.status).toBe(200)

      // The subscriber stamps the refund once it has emailed.
      let stamps: any[] = []
      for (let i = 0; i < 60; i++) {
        stamps = (await orderMetadata(orderId)).refund_emails_sent ?? []
        if (stamps.length) break
        await new Promise((r) => setTimeout(r, 250))
      }
      expect(stamps).toHaveLength(1)
      expect(stamps[0].source).toBe("auto")

      const notifications: any = container().resolve(Modules.NOTIFICATION)
      const mail = (await notifications.listNotifications({ template: "order-refunded" })).filter(
        (n: any) => n.data?.order_id === orderId
      )
      expect(mail).toHaveLength(1)

      // Preview with a note: rendered, addressed, NOT sent, nothing stamped.
      const note = "Your order had a deposit, but you were charged twice. We've refunded the difference."
      const preview = await api.post(
        `/admin/orders/${orderId}/refund-email`,
        { dry_run: true, note },
        adminHeaders
      )
      expect(preview.status).toBe(200)
      expect(preview.data.sent).toBe(false)
      expect(preview.data.preview).toBe(true)
      expect(preview.data.template_source).toBe("live")
      expect(preview.data.to).toMatch(/@jaalyantra\.test$/)
      expect(preview.data.refund_id).toBe(stamps[0].refund_id)
      expect(preview.data.subject).toContain("We've refunded")
      expect(preview.data.html).toContain("We&#x27;ve refunded the difference.")
      // A deposit order: the balance comes from the schedule.
      expect(preview.data.vars.balance_due).toBeTruthy()
      expect(preview.data.vars.balance_when).toBeTruthy()

      const after = (await notifications.listNotifications({ template: "order-refunded" })).filter(
        (n: any) => n.data?.order_id === orderId
      )
      expect(after).toHaveLength(1)
      expect((await orderMetadata(orderId)).refund_emails_sent).toHaveLength(1)

      // A send without confirm is refused.
      const unconfirmed = await api
        .post(`/admin/orders/${orderId}/refund-email`, { note }, adminHeaders)
        .catch((e: any) => e.response)
      expect(unconfirmed.status).toBe(400)

      // Unknown fields are rejected by the validator.
      const stray = await api
        .post(`/admin/orders/${orderId}/refund-email`, { dry_run: true, bogus: 1 }, adminHeaders)
        .catch((e: any) => e.response)
      expect(stray.status).toBe(400)
    })
  })
})
