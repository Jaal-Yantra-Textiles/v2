import {
  createOrderPaymentCollectionWorkflow,
  createTaxRegionsWorkflow,
  markPaymentCollectionAsPaid,
} from "@medusajs/medusa/core-flows"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { IRegionModuleService } from "@medusajs/framework/types"

import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(60000)

/**
 * A design order minted with the buyer's country is TAXED at mint.
 *
 * 🔴 Prod #148 (2026-10-27): the cart was created through the cart module,
 * which writes no tax lines, and checkout only recomputes them when the buyer
 * changes a tax-relevant address field. Cherry picked In Person Pickup, typed
 * no address, and paid ₹2,285.71 with ₹0 GST — while the shipping method,
 * taxed when it was added, carried a 5% GST line. The cart is read back with
 * NO store-side address update, which is exactly the path she took.
 */
setupSharedTestSuite(() => {
  describe("design order GST at mint", () => {
    const { api, getContainer } = getSharedTestEnv()
    let adminHeaders: { headers: Record<string, string> }
    let designId: string
    let regionId: string

    const readCart = async (cartId: string) => {
      const query: any = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "cart",
        fields: ["id", "subtotal", "tax_total", "total", "items.tax_lines.rate"],
        filters: { id: cartId },
      })
      return data[0]
    }

    beforeAll(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)

      const { regions } = (await api.get("/admin/regions?limit=100", adminHeaders)).data
      const existing = (regions ?? []).find(
        (r: any) =>
          String(r.currency_code).toLowerCase() === "inr" &&
          (r.countries ?? []).some((c: any) => c.iso_2 === "in")
      )
      if (existing) {
        regionId = existing.id
      } else {
        const regionService = container.resolve(Modules.REGION) as IRegionModuleService
        const region = await regionService.createRegions({
          name: "Mint Tax INR",
          currency_code: "inr",
          countries: ["in"],
          automatic_taxes: true,
        })
        regionId = region.id
      }

      const tax: any = container.resolve(Modules.TAX)
      if (!(await tax.listTaxRegions({ country_code: "in" })).length) {
        await createTaxRegionsWorkflow(container).run({
          input: [
            {
              country_code: "in",
              provider_id: "tp_system",
              default_tax_rate: { name: "GST", code: "GST", rate: 5 },
            } as any,
          ],
        })
      }

      const designRes = await api.post(
        "/admin/designs",
        {
          name: `Mint Tax Apron ${Date.now()}`,
          description: "taxed at mint",
          design_type: "Original",
          status: "Commerce_Ready",
          priority: "Medium",
          estimated_cost: 8000,
          cost_currency: "inr",
        },
        adminHeaders
      )
      expect(designRes.status).toBe(201)
      designId = designRes.data.design.id
    })

    it("charges GST on the design line with no address update, and after a reprice", async () => {
      const res = await api.post(
        "/admin/designs/draft-order",
        { design_ids: [designId], currency_code: "inr", country_code: "in" },
        adminHeaders
      )
      expect(res.status).toBe(200)
      const cartId = res.data.cart.id

      const minted = await readCart(cartId)
      expect(Number(minted.subtotal)).toBe(8000)
      expect(minted.items[0].tax_lines.map((t: any) => Number(t.rate))).toEqual([5])
      expect(Number(minted.tax_total)).toBeCloseTo(400, 2)
      expect(Number(minted.total)).toBeCloseTo(8400, 2)

      const lineItemId = (
        await (getContainer().resolve(Modules.CART) as any).listLineItems({ cart_id: cartId })
      )[0].id
      const reprice = await api.post(
        `/admin/designs/orders/${lineItemId}/reprice`,
        { unit_price: 2000 },
        adminHeaders
      )
      expect(reprice.status).toBe(200)

      const repriced = await readCart(cartId)
      expect(Number(repriced.tax_total)).toBeCloseTo(100, 2)
      expect(Number(repriced.total)).toBeCloseTo(2100, 2)
    })

    // Cherry, 2026-10-28: ₹800 down agreed on an ₹8,400 order — not 10%.
    it("replaces an unpaid 10% deposit with a fixed ₹800", async () => {
      const res = await api.post(
        "/admin/designs/draft-order",
        { design_ids: [designId], currency_code: "inr", country_code: "in" },
        adminHeaders
      )
      const cartId = res.data.cart.id
      const lineItemId = (
        await (getContainer().resolve(Modules.CART) as any).listLineItems({ cart_id: cartId })
      )[0].id
      const url = `/admin/designs/orders/${lineItemId}/deposit`

      const pct = await api.post(url, { deposit_pct: 10 }, adminHeaders)
      expect(pct.data.design_order_deposit.deposit_amount).toBeCloseTo(840, 2)

      const refused = await api
        .post(url, { deposit_amount: 800 }, adminHeaders)
        .catch((e: any) => e.response)
      expect(refused.status).toBe(409)

      const fixed = await api.post(url, { deposit_amount: 800, replace: true }, adminHeaders)
      expect(fixed.status).toBe(200)
      expect(fixed.data.design_order_deposit).toMatchObject({
        schedule_id: pct.data.design_order_deposit.schedule_id,
        deposit_pct: null,
        deposit_amount: 800,
        balance_amount: 7600,
        total_due: 8400,
        replaced_schedule: true,
      })
    })

    // Prod #148: placed untaxed at ₹2,285.71, paid that, buyer then paid ₹2,400.
    it("adds the missing GST to a placed design order and records the gap as received", async () => {
      const container = getContainer()
      const orderModule: any = container.resolve(Modules.ORDER)
      const [order] = await orderModule.createOrders([
        {
          region_id: regionId,
          currency_code: "inr",
          status: "pending",
          email: "cherry@example.com",
          shipping_address: { first_name: "Cherry", last_name: "M", country_code: "in" },
          metadata: { source: "design-order" },
          items: [{ title: "Apron — Cherry", quantity: 1, unit_price: 2285.71 }],
        },
      ])
      const { result: pc }: any = await createOrderPaymentCollectionWorkflow(container).run({
        input: { order_id: order.id, amount: 2285.71 },
      })
      await markPaymentCollectionAsPaid(container).run({
        input: { payment_collection_id: (Array.isArray(pc) ? pc[0] : pc).id, order_id: order.id },
      })

      const RUN = "/admin/ops/maintenance-jobs/add-missing-design-order-tax/run"
      const preview = await api.post(
        RUN,
        { dry_run: true, params: { order_id: order.id, record_received: true } },
        adminHeaders
      )
      expect(preview.data.result.applied).toBe(false)
      expect(Number((await orderModule.retrieveOrder(order.id, { select: ["id", "total"] })).total))
        .toBeCloseTo(2285.71, 2)

      const applied = await api.post(
        RUN,
        { dry_run: false, params: { order_id: order.id, record_received: true, quantity: 2 } },
        adminHeaders
      )
      expect(applied.data.result.applied).toBe(true)

      const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "order",
        fields: ["id", "total", "tax_total", "summary", "payment_status", "items.quantity", "items.unit_price", "items.detail.quantity"],
        filters: { id: order.id },
      })
      const after = data[0]
      // Founder 2026-10-28: 2 samples, not 1 — same ₹2,400.
      expect(Number(after.items[0].quantity)).toBe(2)
      expect(Number(after.items[0].detail.quantity)).toBe(2)
      expect(Number(after.items[0].unit_price)).toBeCloseTo(1142.855, 3)
      expect(Number(after.tax_total)).toBeCloseTo(114.29, 2)
      expect(Number(after.total)).toBeCloseTo(2400, 2)
      expect(Number(after.summary.paid_total)).toBeCloseTo(2400, 2)
      expect(Number(after.summary.pending_difference)).toBeCloseTo(0, 2)

      const again = await api.post(
        RUN,
        { dry_run: false, params: { order_id: order.id, record_received: true } },
        adminHeaders
      )
      expect(again.data.result.applied).toBe(false)
    })
  })
})
