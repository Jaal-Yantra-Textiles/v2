import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { IOrderModuleService } from "@medusajs/types"

import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import orderPlacedAccrueFeeHandler from "../../src/subscribers/order-placed-accrue-fee"
import { PARTNER_MODULE } from "../../src/modules/partner"

jest.setTimeout(60 * 1000)

/**
 * #623 (follow-up to #336) — per-order partner fee read routes.
 *   GET /admin/orders/:id/partner-fee
 *   GET /partners/orders/:id/partner-fee  (ownership-scoped)
 */
setupSharedTestSuite(() => {
  describe("GET .../orders/:id/partner-fee", () => {
    let adminHeaders: { headers: Record<string, string> }

    beforeAll(async () => {
      const { api, getContainer } = getSharedTestEnv()
      await createAdminUser(getContainer())
      adminHeaders = await getAuthHeaders(api)
    })

    async function createPartner(unique: number) {
      const { api } = getSharedTestEnv()
      const email = `ofee-${unique}@jyt.test`
      const password = "supersecret"
      await api.post("/auth/partner/emailpass/register", { email, password })
      const login1 = await api.post("/auth/partner/emailpass", { email, password })
      let headers = { Authorization: `Bearer ${login1.data.token}` }
      const res = await api.post(
        "/partners",
        {
          name: `OFee ${unique}`,
          handle: `ofee-${unique}`,
          admin: { email, first_name: "Test", last_name: "Partner" },
        },
        { headers }
      )
      expect(res.status).toBe(200)
      // Re-login so the token carries the partner association.
      const login2 = await api.post("/auth/partner/emailpass", { email, password })
      headers = { Authorization: `Bearer ${login2.data.token}` }

      // The order-ownership guard requires the partner to have a store
      // (getPartnerStore). Provision one (mirrors orders-unification tests).
      await api.post(
        "/partners/stores",
        {
          store: {
            name: `OFee Store ${unique}`,
            supported_currencies: [{ currency_code: "usd", is_default: true }],
          },
          sales_channel: { name: `OFee Channel ${unique}`, description: "Default" },
          region: { name: `OFee Region ${unique}`, currency_code: "usd", countries: ["us"] },
          location: {
            name: `OFee Warehouse ${unique}`,
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

      return { partnerId: res.data.partner.id as string, headers }
    }

    async function createOrder(unique: number, currency = "usd") {
      const container = getSharedTestEnv().getContainer()
      const orderService = container.resolve(Modules.ORDER) as IOrderModuleService
      return (await orderService.createOrders({
        currency_code: currency,
        email: `ofee-order-${unique}@jyt.test`,
        items: [
          { title: "Line A", quantity: 2, unit_price: 1000 },
          { title: "Line B", quantity: 1, unit_price: 500 },
        ],
      } as any)) as any
    }

    async function linkPartnerOrder(partnerId: string, orderId: string) {
      const container = getSharedTestEnv().getContainer()
      const remoteLink: any = container.resolve(ContainerRegistrationKeys.LINK)
      await remoteLink.create([
        {
          [PARTNER_MODULE]: { partner_id: partnerId },
          [Modules.ORDER]: { order_id: orderId },
          data: { partner_id: partnerId, order_id: orderId },
        },
      ])
    }

    it("admin route returns the accrued fee + display for a partner order", async () => {
      const { api, getContainer } = getSharedTestEnv()
      const container = getContainer()
      const unique = Date.now()

      const { partnerId } = await createPartner(unique)
      const order = await createOrder(unique)
      await linkPartnerOrder(partnerId, order.id)
      await orderPlacedAccrueFeeHandler({
        event: { data: { id: order.id } },
        container,
      } as any)

      const res = await api.get(
        `/admin/orders/${order.id}/partner-fee`,
        adminHeaders
      )
      expect(res.status).toBe(200)
      expect(res.data.order_id).toBe(order.id)
      expect(res.data.fee).toBeTruthy()
      expect(res.data.fee.order_id).toBe(order.id)
      expect(res.data.fee.partner_id).toBe(partnerId)
      // display contract
      expect(res.data.display).toMatchObject({
        order_id: order.id,
        status: "accrued",
        fee_basis: "percentage",
        is_collectible: true,
        currency_code: "USD",
      })
      expect(res.data.display.rate_label).toMatch(/%$/)
      expect(res.data.display.fee_amount).toBeGreaterThan(0)
    })

    it("admin route returns null fee for a retail order (no fee accrued)", async () => {
      const { api } = getSharedTestEnv()
      const unique = Date.now() + 1
      const order = await createOrder(unique)

      const res = await api.get(
        `/admin/orders/${order.id}/partner-fee`,
        adminHeaders
      )
      expect(res.status).toBe(200)
      expect(res.data.fee).toBeNull()
      expect(res.data.display).toBeNull()
    })

    it("partner route returns the fee for an order the partner owns", async () => {
      const { api, getContainer } = getSharedTestEnv()
      const container = getContainer()
      const unique = Date.now() + 2

      const { partnerId, headers } = await createPartner(unique)
      const order = await createOrder(unique)
      await linkPartnerOrder(partnerId, order.id)
      await orderPlacedAccrueFeeHandler({
        event: { data: { id: order.id } },
        container,
      } as any)

      const res = await api.get(
        `/partners/orders/${order.id}/partner-fee`,
        { headers }
      )
      expect(res.status).toBe(200)
      expect(res.data.fee.partner_id).toBe(partnerId)
      expect(res.data.display.is_collectible).toBe(true)
    })

    it("partner route does NOT leak another partner's order fee (ownership)", async () => {
      const { api, getContainer } = getSharedTestEnv()
      const container = getContainer()
      const unique = Date.now() + 3

      const owner = await createPartner(unique)
      const intruder = await createPartner(unique + 1)
      const order = await createOrder(unique)
      await linkPartnerOrder(owner.partnerId, order.id)
      await orderPlacedAccrueFeeHandler({
        event: { data: { id: order.id } },
        container,
      } as any)

      // Intruder (has their own store, but doesn't own this order) → 404.
      await expect(
        api.get(`/partners/orders/${order.id}/partner-fee`, {
          headers: intruder.headers,
        })
      ).rejects.toMatchObject({ response: { status: 404 } })
    })
  })
})
