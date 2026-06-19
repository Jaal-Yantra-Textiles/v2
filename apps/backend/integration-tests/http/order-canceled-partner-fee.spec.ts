import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils"
import type { IOrderModuleService } from "@medusajs/types"

import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { seedCommonEmailTemplates } from "../helpers/seed-email-templates"
import orderPlacedAccrueFeeHandler from "../../src/subscribers/order-placed-accrue-fee"
import orderCanceledReverseFeeHandler from "../../src/subscribers/order-canceled-reverse-fee"
import { PARTNER_BILLING_MODULE } from "../../src/modules/partner_billing"
import { PARTNER_MODULE } from "../../src/modules/partner"

jest.setTimeout(60 * 1000)

setupSharedTestSuite(() => {
  describe("order.canceled subscriber → partner fee reversal (#336)", () => {
    let adminHeaders: { headers: Record<string, string> }

    beforeAll(async () => {
      const { api, getContainer } = getSharedTestEnv()
      await createAdminUser(getContainer())
      adminHeaders = await getAuthHeaders(api)
      await seedCommonEmailTemplates(api, adminHeaders)
    })

    async function createPartner(unique: number) {
      const { api } = getSharedTestEnv()
      const email = `fee-reversal-${unique}@jyt.test`
      const password = "supersecret"
      await api.post("/auth/partner/emailpass/register", { email, password })
      const login = await api.post("/auth/partner/emailpass", {
        email,
        password,
      })
      const headers = { Authorization: `Bearer ${login.data.token}` }
      const res = await api.post(
        "/partners",
        {
          name: `Fee Reversal ${unique}`,
          handle: `fee-reversal-${unique}`,
          admin: { email, first_name: "Test", last_name: "Partner" },
        },
        { headers }
      )
      expect(res.status).toBe(200)
      return res.data.partner.id as string
    }

    async function createOrder(unique: number, currency = "usd") {
      const container = getSharedTestEnv().getContainer()
      const orderService = container.resolve(
        Modules.ORDER
      ) as IOrderModuleService
      const order: any = await orderService.createOrders({
        currency_code: currency,
        email: `fee-cancel-${unique}@jyt.test`,
        items: [
          { title: "Line A", quantity: 2, unit_price: 1000 },
          { title: "Line B", quantity: 1, unit_price: 500 },
        ],
      } as any)
      return order
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

    it("reverses an accrued fee on cancel, and is idempotent on double-cancel", async () => {
      const { getContainer } = getSharedTestEnv()
      const container = getContainer()
      const unique = Date.now()

      const partnerId = await createPartner(unique)
      const order = await createOrder(unique)
      await linkPartnerOrder(partnerId, order.id)

      // Accrue first (Slice 2), so there is a fee to reverse.
      await orderPlacedAccrueFeeHandler({
        event: { data: { id: order.id } },
        container,
      } as any)

      const billing: any = container.resolve(PARTNER_BILLING_MODULE)
      let fees = await billing.listPartnerFees({ order_id: order.id })
      expect(fees.length).toBe(1)
      expect(fees[0].status).toBe("accrued")

      // Cancel → fee flips to reversed (still exactly one row).
      await orderCanceledReverseFeeHandler({
        event: { data: { id: order.id } },
        container,
      } as any)
      fees = await billing.listPartnerFees({ order_id: order.id })
      expect(fees.length).toBe(1)
      expect(fees[0].status).toBe("reversed")
      expect(fees[0].metadata?.reversed_reason).toBe("order.canceled")
      expect(fees[0].metadata?.reversed_at).toBeTruthy()

      // Double-cancel → still reversed, single row (idempotent no-op).
      await orderCanceledReverseFeeHandler({
        event: { data: { id: order.id } },
        container,
      } as any)
      fees = await billing.listPartnerFees({ order_id: order.id })
      expect(fees.length).toBe(1)
      expect(fees[0].status).toBe("reversed")
    })

    it("is a no-op for a retail order that never accrued a fee", async () => {
      const { getContainer } = getSharedTestEnv()
      const container = getContainer()
      const unique = Date.now() + 1

      const order = await createOrder(unique)
      // No partner link, no accrual → nothing to reverse.

      await orderCanceledReverseFeeHandler({
        event: { data: { id: order.id } },
        container,
      } as any)

      const billing: any = container.resolve(PARTNER_BILLING_MODULE)
      const fees = await billing.listPartnerFees({ order_id: order.id })
      expect(fees.length).toBe(0)
    })
  })
})
