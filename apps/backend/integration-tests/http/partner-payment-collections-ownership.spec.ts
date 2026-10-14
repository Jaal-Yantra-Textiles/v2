import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createOrderPaymentCollectionWorkflow } from "@medusajs/medusa/core-flows"
import type { IOrderModuleService } from "@medusajs/types"

import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { PARTNER_MODULE } from "../../src/modules/partner"

jest.setTimeout(90 * 1000)

/**
 * 🔴 2026-10-14 — the partner payment-collection routes checked only that the
 * caller WAS a partner. Any partner could mark any collection paid, or delete
 * it, by id; create took a raw body and linked nothing. A partner may now act
 * only on a collection whose ORDER it owns.
 */
setupSharedTestSuite(() => {
  describe("/partners/payment-collections ownership", () => {
    async function createPartner(unique: string) {
      const { api } = getSharedTestEnv()
      const email = `paycol-${unique}@jyt.test`
      const password = "supersecret"
      await api.post("/auth/partner/emailpass/register", { email, password })
      const login1 = await api.post("/auth/partner/emailpass", { email, password })
      let headers = { Authorization: `Bearer ${login1.data.token}` }
      const res = await api.post(
        "/partners",
        {
          name: `PayCol ${unique}`,
          handle: `paycol-${unique}`,
          admin: { email, first_name: "Test", last_name: "Partner" },
        },
        { headers }
      )
      expect(res.status).toBe(200)
      const login2 = await api.post("/auth/partner/emailpass", { email, password })
      headers = { Authorization: `Bearer ${login2.data.token}` }

      await api.post(
        "/partners/stores",
        {
          store: {
            name: `PayCol Store ${unique}`,
            supported_currencies: [{ currency_code: "usd", is_default: true }],
          },
          sales_channel: { name: `PayCol Channel ${unique}`, description: "Default" },
          region: { name: `PayCol Region ${unique}`, currency_code: "usd", countries: ["us"] },
          location: {
            name: `PayCol Warehouse ${unique}`,
            address: {
              address_1: "1 Mill Road",
              city: "Austin",
              postal_code: "73301",
              country_code: "US",
            },
          },
        },
        { headers }
      )

      return {
        partnerId: res.data.partner.id as string,
        auth: { headers, validateStatus: () => true },
      }
    }

    async function createOwnedOrder(partnerId: string, unique: string) {
      const container = getSharedTestEnv().getContainer()
      const orderService = container.resolve(Modules.ORDER) as IOrderModuleService
      const order = (await orderService.createOrders({
        currency_code: "usd",
        email: `paycol-order-${unique}@jyt.test`,
        items: [{ title: "Line A", quantity: 1, unit_price: 1000 }],
      } as any)) as any
      const remoteLink: any = container.resolve(ContainerRegistrationKeys.LINK)
      await remoteLink.create([
        {
          [PARTNER_MODULE]: { partner_id: partnerId },
          [Modules.ORDER]: { order_id: order.id },
          data: { partner_id: partnerId, order_id: order.id },
        },
      ])
      return order.id as string
    }

    async function openCollection(orderId: string, amount = 1000) {
      const container = getSharedTestEnv().getContainer()
      const { result } = await createOrderPaymentCollectionWorkflow(container).run({
        input: { order_id: orderId, amount },
      })
      return (Array.isArray(result) ? result[0] : result).id as string
    }

    async function statusOf(paymentCollectionId: string) {
      const query: any = getSharedTestEnv()
        .getContainer()
        .resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "payment_collection",
        fields: ["id", "status"],
        filters: { id: paymentCollectionId },
      })
      return (data?.[0]?.status as string | undefined) ?? null
    }

    it("refuses another partner's collection, and leaves it untouched", async () => {
      const { api } = getSharedTestEnv()
      const unique = `${Date.now()}`
      const owner = await createPartner(`own-${unique}`)
      const intruder = await createPartner(`intr-${unique}`)
      const orderId = await createOwnedOrder(owner.partnerId, unique)
      const pcId = await openCollection(orderId)

      const markRes = await api.post(
        `/partners/payment-collections/${pcId}/mark-as-paid`,
        { order_id: orderId },
        intruder.auth
      )
      expect(markRes.status).toBe(404)

      const delRes = await api.delete(
        `/partners/payment-collections/${pcId}`,
        intruder.auth
      )
      expect(delRes.status).toBe(404)

      const createRes = await api.post(
        "/partners/payment-collections",
        { order_id: orderId, amount: 500 },
        intruder.auth
      )
      expect(createRes.status).toBe(404)

      // 🔑 Read the row back: still there, still unpaid.
      expect(await statusOf(pcId)).toBe("not_paid")
    })

    it("refuses a collection linked to no order at all", async () => {
      const { api, getContainer } = getSharedTestEnv()
      const unique = `${Date.now()}-orphan`
      const partner = await createPartner(unique)
      const paymentService: any = getContainer().resolve(Modules.PAYMENT)
      const [orphan] = await paymentService.createPaymentCollections([
        { currency_code: "usd", amount: 100 },
      ])

      const res = await api.post(
        `/partners/payment-collections/${orphan.id}/mark-as-paid`,
        {},
        partner.auth
      )
      expect(res.status).toBe(404)
      expect(await statusOf(orphan.id)).toBe("not_paid")
    })

    it("lets the owner create, mark paid and delete — with the guards", async () => {
      const { api } = getSharedTestEnv()
      const unique = `${Date.now()}-owner`
      const owner = await createPartner(unique)
      const orderId = await createOwnedOrder(owner.partnerId, unique)
      const otherOrderId = await createOwnedOrder(owner.partnerId, `${unique}-b`)

      // Create: linked to the owner's order.
      const created = await api.post(
        "/partners/payment-collections",
        { order_id: orderId, amount: 1000 },
        owner.auth
      )
      expect(created.status).toBe(200)
      const pcId = created.data.payment_collection.id

      // A body order_id that is not the collection's order is refused.
      const mismatch = await api.post(
        `/partners/payment-collections/${pcId}/mark-as-paid`,
        { order_id: otherOrderId },
        owner.auth
      )
      expect(mismatch.status).toBe(400)
      expect(await statusOf(pcId)).toBe("not_paid")

      // The MCP tool sends no body at all — the linked order is used.
      const paid = await api.post(
        `/partners/payment-collections/${pcId}/mark-as-paid`,
        {},
        owner.auth
      )
      expect(paid.status).toBe(200)
      expect(await statusOf(pcId)).not.toBe("not_paid")

      // A collection that took money cannot be deleted.
      const delPaid = await api.delete(
        `/partners/payment-collections/${pcId}`,
        owner.auth
      )
      expect(delPaid.status).toBe(400)
      expect(await statusOf(pcId)).not.toBeNull()

      // An unpaid one on the owner's order can.
      const unpaidId = await openCollection(otherOrderId, 300)
      const delUnpaid = await api.delete(
        `/partners/payment-collections/${unpaidId}`,
        owner.auth
      )
      expect(delUnpaid.status).toBe(200)
      expect(await statusOf(unpaidId)).toBeNull()
    })
  })
})
