import { createTaxRegionsWorkflow } from "@medusajs/medusa/core-flows"
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
      const serves = (regions ?? []).some(
        (r: any) =>
          String(r.currency_code).toLowerCase() === "inr" &&
          (r.countries ?? []).some((c: any) => c.iso_2 === "in")
      )
      if (!serves) {
        const regionService = container.resolve(Modules.REGION) as IRegionModuleService
        await regionService.createRegions({
          name: "Mint Tax INR",
          currency_code: "inr",
          countries: ["in"],
          automatic_taxes: true,
        })
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
  })
})
