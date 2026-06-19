import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils"
import type { IOrderModuleService } from "@medusajs/types"

import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { seedCommonEmailTemplates } from "../helpers/seed-email-templates"
import orderPlacedAccrueFeeHandler from "../../src/subscribers/order-placed-accrue-fee"
import { PARTNER_MODULE } from "../../src/modules/partner"

jest.setTimeout(60 * 1000)

setupSharedTestSuite(() => {
  describe("GET /admin/partners/:id/fees → partner fee ledger (#336 Slice 4)", () => {
    let adminHeaders: { headers: Record<string, string> }

    beforeAll(async () => {
      const { api, getContainer } = getSharedTestEnv()
      await createAdminUser(getContainer())
      adminHeaders = await getAuthHeaders(api)
      await seedCommonEmailTemplates(api, adminHeaders)
    })

    async function createPartner(unique: number) {
      const { api } = getSharedTestEnv()
      const email = `fee-read-${unique}@jyt.test`
      const password = "supersecret"
      await api.post("/auth/partner/emailpass/register", { email, password })
      const login = await api.post("/auth/partner/emailpass", { email, password })
      const headers = { Authorization: `Bearer ${login.data.token}` }
      const res = await api.post(
        "/partners",
        {
          name: `Fee Read ${unique}`,
          handle: `fee-read-${unique}`,
          admin: { email, first_name: "Test", last_name: "Partner" },
        },
        { headers }
      )
      expect(res.status).toBe(200)
      return res.data.partner.id as string
    }

    async function createOrder(unique: number, currency = "usd") {
      const container = getSharedTestEnv().getContainer()
      const orderService = container.resolve(Modules.ORDER) as IOrderModuleService
      const order: any = await orderService.createOrders({
        currency_code: currency,
        email: `fee-read-order-${unique}@jyt.test`,
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

    it("lists accrued fees with a roll-up summary scoped to the partner", async () => {
      const { api, getContainer } = getSharedTestEnv()
      const container = getContainer()
      const unique = Date.now()

      const partnerId = await createPartner(unique)
      const order = await createOrder(unique)
      await linkPartnerOrder(partnerId, order.id)

      // Accrue a fee (Slice 2) so there is a row to read.
      await orderPlacedAccrueFeeHandler({
        event: { data: { id: order.id } },
        container,
      } as any)

      const res = await api.get(
        `/admin/partners/${partnerId}/fees`,
        adminHeaders
      )
      expect(res.status).toBe(200)
      expect(res.data.partner_id).toBe(partnerId)
      expect(res.data.count).toBe(1)
      expect(res.data.fees).toHaveLength(1)
      expect(res.data.fees[0].partner_id).toBe(partnerId)
      expect(res.data.fees[0].order_id).toBe(order.id)
      expect(res.data.fees[0].status).toBe("accrued")

      // Summary envelope.
      expect(res.data.summary.count).toBe(1)
      expect(res.data.summary.net_fee_amount).toBeGreaterThan(0)
      expect(res.data.summary.by_status.accrued.count).toBe(1)
      expect(res.data.summary.by_currency.usd.count).toBe(1)
    })

    it("returns an empty ledger (zeroed summary) for a partner with no fees", async () => {
      const { api } = getSharedTestEnv()
      const unique = Date.now() + 1
      const partnerId = await createPartner(unique)

      const res = await api.get(
        `/admin/partners/${partnerId}/fees`,
        adminHeaders
      )
      expect(res.status).toBe(200)
      expect(res.data.count).toBe(0)
      expect(res.data.fees).toEqual([])
      expect(res.data.summary).toEqual({
        count: 0,
        total_fee_amount: 0,
        net_fee_amount: 0,
        by_status: {},
        by_currency: {},
      })
    })

    it("filters by status", async () => {
      const { api, getContainer } = getSharedTestEnv()
      const container = getContainer()
      const unique = Date.now() + 2

      const partnerId = await createPartner(unique)
      const order = await createOrder(unique)
      await linkPartnerOrder(partnerId, order.id)
      await orderPlacedAccrueFeeHandler({
        event: { data: { id: order.id } },
        container,
      } as any)

      // accrued filter → the row; reversed filter → empty.
      const accrued = await api.get(
        `/admin/partners/${partnerId}/fees?status=accrued`,
        adminHeaders
      )
      expect(accrued.data.count).toBe(1)

      const reversed = await api.get(
        `/admin/partners/${partnerId}/fees?status=reversed`,
        adminHeaders
      )
      expect(reversed.data.count).toBe(0)
    })
  })
})
