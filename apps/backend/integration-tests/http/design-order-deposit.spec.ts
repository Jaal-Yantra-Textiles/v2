import { createTaxRegionsWorkflow } from "@medusajs/medusa/core-flows"
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
 * POST /admin/designs/orders/:lineItemId/deposit
 *
 * A design order takes a deposit through its SAME checkout link: the payment
 * collection checkout creates is for the deposit, not the total, and the
 * storefront is told the split. From Cherry's 10 aprons (2026-10-27), which had
 * no way to take 10% down.
 *
 * Everything runs in ONE `it`: the shared test runner resets the customer
 * publishable-key session AND cart data between `it` blocks, so all store-side
 * fixtures must be built and consumed within a single test (same constraint as
 * design-to-order-e2e.spec.ts).
 */
setupSharedTestSuite(() => {
  describe("POST /admin/designs/orders/:lineItemId/deposit", () => {
    let adminHeaders: { headers: Record<string, string> }
    let customerHeaders: { headers: Record<string, string> }
    let designId: string
    let regionId: string

    const { api, getContainer } = getSharedTestEnv()

    // Build a fresh design order (cart → design line item → address); returns
    // its line_item_id. Uses the suite's single customer/key session.
    const buildDesignOrder = async (): Promise<{ lineItemId: string; cartId: string }> => {
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
      return { lineItemId, cartId }
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
          name: "Deposit Test Region",
          currency_code: "usd",
          countries: ["us"],
        })
        regionId = region.id
      }

      const designRes = await api.post(
        "/admin/designs",
        {
          name: `Deposit Design ${Date.now()}`,
          description: "deposit test",
          design_type: "Original",
          status: "Commerce_Ready",
          priority: "Medium",
          estimated_cost: 250,
        },
        adminHeaders
      )
      designId = designRes.data.design.id
      await setupCheckoutInfrastructure(container, regionId)

      // #2328 — the region must charge tax, or a capture of the PRE-tax total
      // is indistinguishable from the right one. 5% like Indian GST on textiles.
      const tax: any = container.resolve(Modules.TAX)
      const existingTax = await tax.listTaxRegions({ country_code: "us" })
      if (!existingTax.length) {
        await createTaxRegionsWorkflow(container).run({
          input: [
            {
              country_code: "us",
              provider_id: "tp_system",
              default_tax_rate: { name: "Test GST", code: "TEST-GST", rate: 5 },
            } as any,
          ],
        })
      }

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

    it("collects the deposit, not the total, and refuses what would break it", async () => {
      const deposit = (lineItemId: string, body: Record<string, unknown>) =>
        api
          .post(`/admin/designs/orders/${lineItemId}/deposit`, body, adminHeaders)
          .catch((e: any) => e.response)
      const collect = async (cartId: string) =>
        (await api.post("/store/payment-collections", { cart_id: cartId }, customerHeaders))
          .data.payment_collection
      const terms = async (cartId: string) =>
        (await api.get(`/store/carts/${cartId}/quote-terms`, customerHeaders)).data.quote_terms

      // ── A fresh design order takes a 10% deposit ──────────────────────────
      const a = await buildDesignOrder()
      // Before a deposit the cart is an ordinary one, and says so.
      expect((await terms(a.cartId)).is_quote_cart).toBe(false)
      const total = Number(
        (await api.get(`/store/carts/${a.cartId}`, customerHeaders)).data.cart.total
      )
      expect(total).toBeGreaterThan(0)

      const bad = await deposit(a.lineItemId, { deposit_pct: 0 })
      expect(bad.status).toBe(400)
      expect(bad.data.reason).toBe("not_a_pct")

      const set = await deposit(a.lineItemId, { deposit_pct: 10 })
      expect(set.status).toBe(200)
      const d = set.data.design_order_deposit
      expect(d.deposit_pct).toBe(10)
      expect(d.total_due).toBeCloseTo(total, 2)
      expect(d.deposit_amount).toBeCloseTo(total * 0.1, 2)
      expect(d.deposit_amount + d.balance_amount).toBeCloseTo(total, 2)
      expect(d.balance_trigger).toBe("manual")
      expect(d.cleared_payment_collection_id).toBeNull()

      // Checkout charges the deposit, and the storefront is told so.
      expect(Number((await collect(a.cartId)).amount)).toBeCloseTo(d.deposit_amount, 2)
      const t = await terms(a.cartId)
      expect(t.is_quote_cart).toBe(true)
      expect(t.deposit_due_now).toBeCloseTo(d.deposit_amount, 2)
      expect(t.balance_due_later).toBeCloseTo(d.balance_amount, 2)

      // One schedule per cart, and the price is frozen under it.
      const again = await deposit(a.lineItemId, { deposit_pct: 20 })
      expect(again.status).toBe(409)
      expect(again.data.reason).toBe("already_has_deposit")
      const reprice = await api
        .post(`/admin/designs/orders/${a.lineItemId}/reprice`, { unit_price: 999 }, adminHeaders)
        .catch((e: any) => e.response)
      expect(reprice.status).toBe(409)
      expect(reprice.data.reason).toBe("has_deposit")

      // ── A buyer who already opened checkout: the full-total collection ────
      // is cleared so the next checkout makes the deposit one.
      const b = await buildDesignOrder()
      const stale = await collect(b.cartId)
      const setB = await deposit(b.lineItemId, { deposit_pct: 25, balance_trigger: "dispatch" })
      expect(setB.status).toBe(200)
      expect(setB.data.design_order_deposit.cleared_payment_collection_id).toBe(stale.id)
      expect(setB.data.design_order_deposit.balance_trigger).toBe("dispatch")
      const fresh = await collect(b.cartId)
      expect(fresh.id).not.toBe(stale.id)
      expect(Number(fresh.amount)).toBeCloseTo(
        setB.data.design_order_deposit.deposit_amount,
        2
      )
    })
  })
})
