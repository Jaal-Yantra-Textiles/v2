import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils"
import type { IOrderModuleService } from "@medusajs/types"

import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { seedCommonEmailTemplates } from "../helpers/seed-email-templates"
import orderPlacedAccrueFeeHandler from "../../src/subscribers/order-placed-accrue-fee"
import { PARTNER_BILLING_MODULE } from "../../src/modules/partner_billing"
import { PARTNER_MODULE } from "../../src/modules/partner"

jest.setTimeout(60 * 1000)

setupSharedTestSuite(() => {
  describe("order.placed subscriber → partner fee accrual (#336)", () => {
    let adminHeaders: { headers: Record<string, string> }

    beforeAll(async () => {
      const { api, getContainer } = getSharedTestEnv()
      await createAdminUser(getContainer())
      adminHeaders = await getAuthHeaders(api)
      await seedCommonEmailTemplates(api, adminHeaders)
    })

    async function createPartner(unique: number) {
      const { api } = getSharedTestEnv()
      const email = `fee-accrual-${unique}@jyt.test`
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
          name: `Fee Accrual ${unique}`,
          handle: `fee-accrual-${unique}`,
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
        email: `fee-order-${unique}@jyt.test`,
        items: [
          { title: "Line A", quantity: 2, unit_price: 1000 },
          { title: "Line B", quantity: 1, unit_price: 500 },
        ],
      } as any)
      return order
    }

    async function linkPartnerOrder(partnerId: string, orderId: string) {
      const container = getSharedTestEnv().getContainer()
      const remoteLink: any = container.resolve(
        ContainerRegistrationKeys.LINK
      )
      await remoteLink.create([
        {
          [PARTNER_MODULE]: { partner_id: partnerId },
          [Modules.ORDER]: { order_id: orderId },
          data: { partner_id: partnerId, order_id: orderId },
        },
      ])
    }

    it("does NOT accrue a commission on a WORK order (partner-linked), even when re-fired", async () => {
      // #2262, founder decision A (2026-09-24): a work order is a purchase FROM
      // the partner; no commission on money we pay them. The D3 partner↔order
      // link is written only by the work-order mirror, so it marks a work order.
      // This test used to assert a 2% fee here — backfill-partner-order-fees
      // accrued 44 of them on prod before this was decided.
      const { getContainer } = getSharedTestEnv()
      const container = getContainer()
      const unique = Date.now()

      const partnerId = await createPartner(unique)
      const order = await createOrder(unique)
      await linkPartnerOrder(partnerId, order.id)

      await orderPlacedAccrueFeeHandler({
        event: { data: { id: order.id } },
        container,
      } as any)
      await orderPlacedAccrueFeeHandler({
        event: { data: { id: order.id } },
        container,
      } as any)

      const billing: any = container.resolve(PARTNER_BILLING_MODULE)
      const fees = await billing.listPartnerFees({ order_id: order.id })
      expect(fees).toEqual([])
    })

    it("does NOT accrue a fee for a retail order with no partner link", async () => {
      const { getContainer } = getSharedTestEnv()
      const container = getContainer()
      const unique = Date.now() + 1

      const order = await createOrder(unique)
      // No partner↔order link → retail → must be skipped.

      await orderPlacedAccrueFeeHandler({
        event: { data: { id: order.id } },
        container,
      } as any)

      const billing: any = container.resolve(PARTNER_BILLING_MODULE)
      const fees = await billing.listPartnerFees({ order_id: order.id })
      expect(fees.length).toBe(0)
    })
  })
})
