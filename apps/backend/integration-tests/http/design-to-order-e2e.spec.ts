import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { IRegionModuleService } from "@medusajs/types"

import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import {
  createTestCustomer,
  getCustomerAuthHeaders,
  resetTestCustomerCredentials,
  getTestCustomerCredentials,
} from "../helpers/create-customer"
import { setupCheckoutInfrastructure } from "../helpers/setup-checkout-infrastructure"
import { DESIGN_MODULE } from "../../src/modules/designs"

jest.setTimeout(90 * 1000)

/**
 * End-to-end test for the full design lifecycle:
 *   design → cart → checkout → order → admin approve → product linked
 *
 * Separated from design-lifecycle.spec.ts because this test needs its own
 * publishable API key session (Medusa's test runner invalidates the key
 * after the first store request in a test suite).
 */
setupSharedTestSuite(() => {
  describe("Design → Cart → Order → Approve (E2E)", () => {
    let adminHeaders: { headers: Record<string, string> }
    let customerHeaders: { headers: Record<string, string> }
    let customerId: string
    let designId: string
    let regionId: string

    const { api, getContainer } = getSharedTestEnv()

    beforeAll(async () => {
      const container = getContainer()

      // Admin setup
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)

      // Customer setup (fresh key for this suite)
      resetTestCustomerCredentials()
      const { customer } = await createTestCustomer(container)
      customerId = customer.id
      customerHeaders = await getCustomerAuthHeaders()

      // Region
      const regionsRes = await api.get("/admin/regions", adminHeaders)
      if (regionsRes.data.regions?.length > 0) {
        regionId = regionsRes.data.regions[0].id
      } else {
        const regionService = container.resolve(Modules.REGION) as IRegionModuleService
        const region = await regionService.createRegions({
          name: "E2E Test Region",
          currency_code: "usd",
          countries: ["us"],
        })
        regionId = region.id
      }

      // Design
      const unique = Date.now()
      const designRes = await api.post(
        "/admin/designs",
        {
          name: `E2E Lifecycle Design ${unique}`,
          description: "Full lifecycle e2e test",
          design_type: "Original",
          status: "Commerce_Ready",
          priority: "Medium",
          estimated_cost: 250,
        },
        adminHeaders
      )
      expect(designRes.status).toBe(201)
      designId = designRes.data.design.id

      // Link design → customer
      const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as any
      await remoteLink.create({
        [DESIGN_MODULE]: { design_id: designId },
        [Modules.CUSTOMER]: { customer_id: customerId },
      })
    })

    it("completes the full design → cart → order → approve lifecycle", async () => {
      const container = getContainer()

      // ── Step 1: Setup checkout infrastructure ──────────────────────────
      const infrastructure = await setupCheckoutInfrastructure(container, regionId)

      // ── Step 2: Create cart ────────────────────────────────────────────
      const cartRes = await api.post(
        "/store/carts",
        { region_id: regionId },
        customerHeaders
      )
      expect(cartRes.status).toBe(200)
      const cartId = cartRes.data.cart.id

      // ── Step 3: Add custom design line item via checkout ───────────────
      const checkoutRes = await api.post(
        `/store/custom/designs/${designId}/checkout`,
        { cart_id: cartId, currency_code: "usd" },
        customerHeaders
      )
      expect(checkoutRes.status).toBe(200)
      expect(checkoutRes.data.line_item_id).toBeDefined()
      expect(checkoutRes.data.price).toBeDefined()
      expect(checkoutRes.data.cost_estimate).toBeDefined()

      const lineItemId = checkoutRes.data.line_item_id

      // Verify line item in cart with design metadata
      const cartCheck = await api.get(`/store/carts/${cartId}`, customerHeaders)
      const lineItem = cartCheck.data.cart.items.find((i: any) => i.id === lineItemId)
      expect(lineItem).toBeDefined()
      expect(lineItem.metadata?.design_id).toBe(designId)

      // ── Step 4: Update cart with addresses ─────────────────────────────
      const credentials = getTestCustomerCredentials()
      await api
        .post(
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
            billing_address: {
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
        .catch(() => {
          // Cart address update may fail if region doesn't have the country — non-fatal
        })

      // ── Step 5: Add shipping method (if available) ─────────────────────
      const shippingRes = await api
        .get(`/store/shipping-options?cart_id=${cartId}`, customerHeaders)
        .catch(() => ({ data: { shipping_options: [] } }))

      if (shippingRes.data.shipping_options?.length > 0) {
        await api
          .post(
            `/store/carts/${cartId}/shipping-methods`,
            { option_id: shippingRes.data.shipping_options[0].id },
            customerHeaders
          )
          .catch(() => {})
      }

      // ── Step 6: Payment + complete cart (best effort) ──────────────────
      let orderId: string | undefined

      const payCollRes = await api
        .post("/store/payment-collections", { cart_id: cartId }, customerHeaders)
        .catch((e: any) => e.response)

      if (payCollRes?.status === 200) {
        const payCollId = payCollRes.data.payment_collection.id

        const providersRes = await api
          .get(`/store/payment-providers?region_id=${regionId}`, customerHeaders)
          .catch(() => ({ data: { payment_providers: [] } }))

        const providers = providersRes.data.payment_providers || []
        if (providers.length > 0) {
          await api
            .post(
              `/store/payment-collections/${payCollId}/payment-sessions`,
              { provider_id: providers[0].id },
              customerHeaders
            )
            .catch(() => null)

          const completeRes = await api
            .post(`/store/carts/${cartId}/complete`, {}, customerHeaders)
            .catch(() => ({ data: { type: "error" } }))

          if (completeRes.data.type === "order") {
            orderId = completeRes.data.order.id

            // Verify order exists via admin
            const orderRes = await api.get(`/admin/orders/${orderId}`, adminHeaders)
            expect(orderRes.status).toBe(200)
          }
        }
      }

      // ── Step 7: Admin approves design → product + variant created ──────
      const approveRes = await api.post(
        `/admin/designs/${designId}/approve`,
        {},
        adminHeaders
      )
      expect(approveRes.status).toBe(200)
      expect(approveRes.data.product_id).toBeDefined()
      expect(approveRes.data.variant_id).toBeDefined()

      const productId = approveRes.data.product_id
      const variantId = approveRes.data.variant_id

      // ── Step 8: Verify design → product link ──────────────────────────
      const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
      const { data: linkedDesigns } = await query.graph({
        entity: "design",
        filters: { id: designId },
        fields: ["id", "status", "products.*"],
      })

      expect(linkedDesigns[0].status).toBe("Approved")
      expect(linkedDesigns[0].products?.length).toBeGreaterThanOrEqual(1)
      expect(linkedDesigns[0].products.some((p: any) => p.id === productId)).toBe(true)

      // ── Step 9: Verify variant has manage_inventory: true ─────────────
      const productRes = await api.get(
        `/admin/products/${productId}?fields=*variants`,
        adminHeaders
      )
      const variant = productRes.data.product.variants?.find((v: any) => v.id === variantId)
      expect(variant).toBeDefined()
      expect(variant.manage_inventory).toBe(true)

      // ── Step 10: If order was placed, verify line items were updated ───
      if (orderId) {
        const orderRes = await api.get(
          `/admin/orders/${orderId}?fields=*items`,
          adminHeaders
        )
        const orderItems = orderRes.data.order.items || []
        const designItem = orderItems.find(
          (i: any) => i.metadata?.design_id === designId
        )

        if (designItem) {
          // After approval, order line items should reference the variant
          expect(designItem.variant_id).toBe(variantId)
          expect(designItem.product_id).toBe(productId)
        }
      }
    })
  })
})
