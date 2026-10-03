import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { IRegionModuleService } from "@medusajs/types"

import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { createTestCustomer, getCustomerAuthHeaders } from "../helpers/create-customer"
import { setupCheckoutInfrastructure } from "../helpers/setup-checkout-infrastructure"
import { DESIGN_MODULE } from "../../src/modules/designs"
import { WORK_ORDER_MODULE } from "../../src/modules/work_orders"

jest.setTimeout(120 * 1000)

/**
 * A partner's WORK ORDER on a design is not the customer's PURCHASE.
 *
 * Since #2306 a design goes into production before its buyer pays, and the
 * partner's work order links to the design. The design-order mutations
 * (attach customer / reprice / cancel) decide "already converted" from the
 * design↔order link, so they refused every change with 409 — on prod, Kunal's
 * ₹10,000 Chupa order could not be attached to him because Sharlho's work
 * order #119 sat on the design. Only a SALE order may block them.
 */
setupSharedTestSuite(() => {
  describe("design-order mutations ignore work orders on the design", () => {
    const { api, getContainer } = getSharedTestEnv()
    let adminHeaders: { headers: Record<string, string> }
    let customerHeaders: { headers: Record<string, string> }
    let regionId: string
    let customerId: string

    const makeDesign = async (label: string) => {
      const res = await api.post(
        "/admin/designs",
        {
          name: `${label} ${Date.now()}`,
          design_type: "Original",
          status: "Commerce_Ready",
          priority: "Medium",
          estimated_cost: 250,
        },
        adminHeaders
      )
      const designId = res.data.design.id as string
      // The store checkout only serves a design linked to the buyer.
      const remoteLink = getContainer().resolve(ContainerRegistrationKeys.LINK) as any
      await remoteLink.create({
        [DESIGN_MODULE]: { design_id: designId },
        [Modules.CUSTOMER]: { customer_id: customerId },
      })
      return designId
    }

    const makeDesignOrder = async (designId: string): Promise<string> => {
      const cartRes = await api.post("/store/carts", { region_id: regionId }, customerHeaders)
      const checkout = await api.post(
        `/store/custom/designs/${designId}/checkout`,
        { cart_id: cartRes.data.cart.id, currency_code: "usd" },
        customerHeaders
      )
      expect(checkout.status).toBe(200)
      return checkout.data.line_item_id as string
    }

    const linkDesignToOrder = async (designId: string, orderId: string) => {
      const remoteLink = getContainer().resolve(ContainerRegistrationKeys.LINK) as any
      await remoteLink.create({
        [DESIGN_MODULE]: { design_id: designId },
        [Modules.ORDER]: { order_id: orderId },
      })
    }

    beforeAll(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)

      const regions = await api.get("/admin/regions", adminHeaders)
      if (regions.data.regions?.length) {
        regionId = regions.data.regions[0].id
      } else {
        const regionService = container.resolve(Modules.REGION) as IRegionModuleService
        regionId = (
          await regionService.createRegions({ name: "WO Test Region", currency_code: "usd", countries: ["us"] })
        ).id
      }
      await setupCheckoutInfrastructure(container, regionId)
      const { customer } = await createTestCustomer(container)
      customerId = customer.id
      customerHeaders = await getCustomerAuthHeaders()
    })

    it("attaches a customer when the only linked order is a partner's work order", async () => {
      const designId = await makeDesign("In production before payment")
      const lineItemId = await makeDesignOrder(designId)

      const workOrders = getContainer().resolve(WORK_ORDER_MODULE) as any
      const wo = await workOrders.createWorkOrders({ kind: "design", currency_code: "inr" })
      await linkDesignToOrder(designId, wo.id)

      const res = await api
        .post(`/admin/designs/orders/${lineItemId}/customer`, { customer_id: customerId }, adminHeaders)
        .catch((e: any) => e.response)
      expect(res.status).toBe(200)

      // Reprice is unblocked by the same rule.
      const reprice = await api
        .post(`/admin/designs/orders/${lineItemId}/reprice`, { unit_price: 300 }, adminHeaders)
        .catch((e: any) => e.response)
      expect(reprice.status).toBe(200)
    })

    it("still refuses when the design is linked to a sale order", async () => {
      const designId = await makeDesign("Already sold")
      const lineItemId = await makeDesignOrder(designId)
      // An order id with no work_order row — a sale.
      await linkDesignToOrder(designId, "order_01SALEORDERNOTAWORKORDER0")

      const res = await api
        .post(`/admin/designs/orders/${lineItemId}/customer`, { customer_id: customerId }, adminHeaders)
        .catch((e: any) => e.response)
      expect(res.status).toBe(409)
    })
  })
})
