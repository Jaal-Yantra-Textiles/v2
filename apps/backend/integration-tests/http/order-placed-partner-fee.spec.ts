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
import { computeFee } from "../../src/modules/partner_billing/lib/compute-fee"

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

    it("accrues one 2% partner_fee for a partner-linked order, and is idempotent", async () => {
      const { getContainer } = getSharedTestEnv()
      const container = getContainer()
      const unique = Date.now()

      const partnerId = await createPartner(unique)
      const order = await createOrder(unique)
      await linkPartnerOrder(partnerId, order.id)

      // Re-read total post-creation (taxes/shipping may adjust it).
      const orderService = container.resolve(
        Modules.ORDER
      ) as IOrderModuleService
      const placed: any = await orderService.retrieveOrder(order.id, {
        select: ["id", "total", "currency_code"],
      })
      const expectedFee = computeFee(Number(placed.total), "percentage", 200)

      await orderPlacedAccrueFeeHandler({
        event: { data: { id: order.id } },
        container,
      } as any)

      const billing: any = container.resolve(PARTNER_BILLING_MODULE)
      let fees = await billing.listPartnerFees({ order_id: order.id })
      expect(fees.length).toBe(1)
      const fee = fees[0]
      expect(fee.partner_id).toBe(partnerId)
      expect(fee.status).toBe("accrued")
      expect(fee.fee_basis).toBe("percentage")
      expect(fee.fee_rate).toBe(200)
      expect(fee.currency_code).toBe("usd")
      expect(Number(fee.fee_amount)).toBeCloseTo(expectedFee, 2)
      expect(fee.accrued_at).toBeTruthy()

      // Re-fire → still exactly one (idempotent on order_id).
      await orderPlacedAccrueFeeHandler({
        event: { data: { id: order.id } },
        container,
      } as any)
      fees = await billing.listPartnerFees({ order_id: order.id })
      expect(fees.length).toBe(1)
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
