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

jest.setTimeout(120 * 1000)

/**
 * #404 (#31) PR-A — POST /admin/designs/orders/:lineItemId/convert
 *
 * A design order (a cart carrying a design line item, no backing order yet) is
 * converted admin-side into a real order: prepaid → marked paid, COD → unpaid.
 *
 * Everything runs in ONE `it`: the shared test runner resets the customer
 * publishable-key session AND cart data between `it` blocks, so all store-side
 * fixtures must be built and consumed within a single test (same constraint as
 * design-to-order-e2e.spec.ts).
 */
setupSharedTestSuite(() => {
  describe("POST /admin/designs/orders/:lineItemId/convert", () => {
    let adminHeaders: { headers: Record<string, string> }
    let customerHeaders: { headers: Record<string, string> }
    let designId: string
    let regionId: string

    const { api, getContainer } = getSharedTestEnv()

    // Build a fresh design order (cart → design line item → address); returns
    // its line_item_id. Uses the suite's single customer/key session.
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
      expect(lineItemId).toBeDefined()

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
          name: "Convert Test Region",
          currency_code: "usd",
          countries: ["us"],
        })
        regionId = region.id
      }

      const designRes = await api.post(
        "/admin/designs",
        {
          name: `Convert Design ${Date.now()}`,
          description: "convert-to-order test",
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

    it("converts design orders — prepaid (paid), idempotency guard, and COD (unpaid)", async () => {
      // ── prepaid → marked paid ────────────────────────────────────────
      const prepaidLi = await buildDesignOrder()
      const prepaid = await api.post(
        `/admin/designs/orders/${prepaidLi}/convert`,
        { payment_mode: "prepaid" },
        adminHeaders
      )
      expect(prepaid.status).toBe(200)
      const conv = prepaid.data.design_order_conversion
      expect(conv.order_id).toEqual(expect.any(String))
      expect(conv.payment_mode).toBe("prepaid")
      expect(conv.linked_design_ids).toContain(designId)
      // convertDraftOrder flips draft→pending + is_draft_order=false together.
      expect(conv.status).toBe("pending")
      // Marked paid via the system provider → collection fully paid.
      expect(["paid", "captured", "authorized", "completed"]).toContain(
        conv.payment_status
      )

      // ── idempotency: re-converting the same design order is rejected ──
      const again = await api
        .post(`/admin/designs/orders/${prepaidLi}/convert`, {}, adminHeaders)
        .catch((e: any) => e.response)
      expect(again.status).toBe(400) // MedusaError NOT_ALLOWED

      // ── COD → order created unpaid ───────────────────────────────────
      const codLi = await buildDesignOrder()
      const cod = await api.post(
        `/admin/designs/orders/${codLi}/convert`,
        { payment_mode: "cod" },
        adminHeaders
      )
      expect(cod.status).toBe(200)
      const codConv = cod.data.design_order_conversion
      expect(codConv.payment_mode).toBe("cod")
      expect(codConv.status).toBe("pending")
      // Unpaid: a payment collection exists but was never captured.
      expect(["not_paid", "awaiting"]).toContain(codConv.payment_status)
    })
  })
})
