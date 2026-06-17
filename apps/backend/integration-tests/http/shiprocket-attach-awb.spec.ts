import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { IRegionModuleService } from "@medusajs/types"

import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import {
  createTestCustomer,
  getCustomerAuthHeaders,
  getTestCustomerCredentials,
} from "../helpers/create-customer"
import { setupCheckoutInfrastructure } from "../helpers/setup-checkout-infrastructure"
import { DESIGN_MODULE } from "../../src/modules/designs"
import { ensureOrderFulfillment } from "../../src/workflows/orders/fulfillment-context"

jest.setTimeout(120 * 1000)

/**
 * #437 — fulfillment plumbing for the Shiprocket label / attach-AWB routes.
 *
 * The core verification: a CONVERTED design order (title-only line items, NO
 * shipping method) can have a fulfillment created for it. Before the shared
 * `ensureOrderFulfillment` fix this 500'd in core's createOrderFulfillmentWorkflow
 * (null shipping option → null location). Shiprocket itself isn't registered in
 * the test env, so this asserts the fulfillment-creation half end-to-end.
 */
setupSharedTestSuite(() => {
  describe("ensureOrderFulfillment for converted design orders (#437)", () => {
    let adminHeaders: { headers: Record<string, string> }
    let customerHeaders: { headers: Record<string, string> }
    let designId: string
    let regionId: string

    const { api, getContainer } = getSharedTestEnv()

    const buildDesignOrder = async (): Promise<string> => {
      const cartRes = await api.post(
        "/store/carts",
        { region_id: regionId },
        customerHeaders
      )
      const cartId = cartRes.data.cart.id

      const checkoutRes = await api.post(
        `/store/custom/designs/${designId}/checkout`,
        { cart_id: cartId, currency_code: "usd" },
        customerHeaders
      )
      expect(checkoutRes.status).toBe(200)
      const lineItemId = checkoutRes.data.line_item_id

      const credentials = getTestCustomerCredentials()
      await api.post(
        `/store/carts/${cartId}`,
        {
          email: credentials.email,
          shipping_address: {
            first_name: "Test",
            last_name: "Customer",
            address_1: "123 Main St",
            city: "New York",
            postal_code: "10001",
            country_code: "us",
          },
        },
        customerHeaders
      )
      return lineItemId
    }

    beforeAll(async () => {
      const container = getContainer()

      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)

      const regionsRes = await api.get("/admin/regions", adminHeaders)
      if (regionsRes.data.regions?.length > 0) {
        regionId = regionsRes.data.regions[0].id
      } else {
        const regionService = container.resolve(
          Modules.REGION
        ) as IRegionModuleService
        const region = await regionService.createRegions({
          name: "Attach AWB Region",
          currency_code: "usd",
          countries: ["us"],
        })
        regionId = region.id
      }

      const designRes = await api.post(
        "/admin/designs",
        {
          name: `Attach AWB Design ${Date.now()}`,
          description: "attach-awb fulfillment test",
          design_type: "Original",
          status: "Commerce_Ready",
          priority: "Medium",
          estimated_cost: 250,
        },
        adminHeaders
      )
      designId = designRes.data.design.id
      await setupCheckoutInfrastructure(container, regionId)

      const { customer } = await createTestCustomer(container)
      customerHeaders = await getCustomerAuthHeaders()
      const remoteLink = container.resolve(
        ContainerRegistrationKeys.LINK
      ) as any
      await remoteLink
        .create({
          [DESIGN_MODULE]: { design_id: designId },
          [Modules.CUSTOMER]: { customer_id: customer.id },
        })
        .catch(() => {})
    })

    it("creates a fulfillment for a converted (title-only) order, and is idempotent", async () => {
      const container = getContainer()
      const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

      // Convert a design order → real order with title-only line items.
      const lineItemId = await buildDesignOrder()
      const convertRes = await api.post(
        `/admin/designs/orders/${lineItemId}/convert`,
        { payment_mode: "prepaid" },
        adminHeaders
      )
      expect(convertRes.status).toBe(200)
      const orderId = convertRes.data.design_order_conversion.order_id
      expect(orderId).toEqual(expect.any(String))

      // The order starts with no fulfillment.
      const { data: before } = await query.graph({
        entity: "order",
        fields: ["id", "fulfillments.id"],
        filters: { id: orderId },
      })
      expect((before?.[0]?.fulfillments || []).length).toBe(0)

      // This used to 500 (no shipping method → null shipping option/location).
      const fulfillmentId = await ensureOrderFulfillment(container, orderId)
      expect(fulfillmentId).toEqual(expect.any(String))

      const { data: after } = await query.graph({
        entity: "order",
        fields: ["id", "fulfillments.id", "fulfillments.items.quantity"],
        filters: { id: orderId },
      })
      const fulfillments = after?.[0]?.fulfillments || []
      expect(fulfillments.length).toBe(1)
      expect(fulfillments[0].id).toBe(fulfillmentId)
      // The title-only line item is on the fulfillment.
      expect((fulfillments[0].items || []).length).toBeGreaterThan(0)

      // Idempotent: a second call reuses the same fulfillment (no duplicate).
      const again = await ensureOrderFulfillment(container, orderId)
      expect(again).toBe(fulfillmentId)
      const { data: afterAgain } = await query.graph({
        entity: "order",
        fields: ["id", "fulfillments.id"],
        filters: { id: orderId },
      })
      expect((afterAgain?.[0]?.fulfillments || []).length).toBe(1)

      // ── attach route over HTTP: clean error, not an opaque 500 ──────────
      // Shiprocket isn't configured in the test env, so the AWB lookup can't
      // resolve. The route must still surface a structured MedusaError (with a
      // message the UI toast can show), having run ensureOrderFulfillment first.
      const lineItemId2 = await buildDesignOrder()
      const convert2 = await api.post(
        `/admin/designs/orders/${lineItemId2}/convert`,
        { payment_mode: "prepaid" },
        adminHeaders
      )
      const orderId2 = convert2.data.design_order_conversion.order_id
      const attachErr = await api
        .post(
          `/admin/orders/${orderId2}/shiprocket-attach-awb`,
          { awb: "FAKEAWB123" },
          adminHeaders
        )
        .catch((e: any) => e.response)
      expect(attachErr).toBeDefined()
      // structured error body with a real message — never an empty/opaque crash
      expect(typeof attachErr.data?.message).toBe("string")
      expect(attachErr.data.message.length).toBeGreaterThan(0)

      // Empty AWB is rejected by validation (clean 400).
      const blankErr = await api
        .post(
          `/admin/orders/${orderId2}/shiprocket-attach-awb`,
          { awb: "" },
          adminHeaders
        )
        .catch((e: any) => e.response)
      expect(blankErr.status).toBe(400)
    })
  })
})
