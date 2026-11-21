import { createTaxRegionsWorkflow } from "@medusajs/medusa/core-flows"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { IRegionModuleService } from "@medusajs/framework/types"

import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(60000)

/**
 * Amend a design order the buyer has not paid yet (Sreeni Vasan, 2026-11-21:
 * "add one trouser and a Kashmir wool shirt"). Before this the only way was to
 * cancel and re-issue, killing the link the buyer already had.
 */
setupSharedTestSuite(() => {
  describe("amend an unpaid design order", () => {
    const { api, getContainer } = getSharedTestEnv()
    let adminHeaders: { headers: Record<string, string> }
    let designId: string
    let trouserId: string
    let shirtId: string
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
          name: `Amend Blazer ${Date.now()}`,
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
      const mk = async (name: string, cost: number) =>
        (
          await api.post(
            "/admin/designs",
            {
              name: `${name} ${Date.now()}`,
              description: "amend",
              design_type: "Custom",
              status: "Conceptual",
              priority: "Medium",
              estimated_cost: cost,
              cost_currency: "inr",
            },
            adminHeaders
          )
        ).data.design.id
      trouserId = await mk("Amend Trouser", 3000)
      shirtId = await mk("Amend Wool Shirt", 5000)
    })

    const lineIds = async (cartId: string) =>
      (await (getContainer().resolve(Modules.CART) as any).listLineItems({ cart_id: cartId })).map(
        (l: any) => l.id
      )

    it("adds two designs to the same cart, taxed, and keeps the link", async () => {
      const res = await api.post(
        "/admin/designs/draft-order",
        { design_ids: [designId], currency_code: "inr", country_code: "in" },
        adminHeaders
      )
      const cartId = res.data.cart.id
      const [anchor] = await lineIds(cartId)

      const amend = await api.post(
        `/admin/designs/orders/${anchor}/items`,
        { add_design_ids: [trouserId, shirtId], price_overrides: { [shirtId]: 6000 } },
        adminHeaders
      )
      expect(amend.status).toBe(200)
      const out = amend.data.design_order_amend
      expect(out.cart_id).toBe(cartId)
      expect(out.added_line_item_ids).toHaveLength(2)
      expect(out.email).toBeNull()

      const cart = await readCart(cartId)
      expect(cart.items).toHaveLength(3)
      // 8000 (estimate) + 3000 (estimate) + 6000 (override), 5% GST on each
      expect(Number(cart.subtotal)).toBe(17000)
      expect(Number(cart.tax_total)).toBeCloseTo(850, 2)
      expect(Number(cart.total)).toBeCloseTo(17850, 2)

      // Each new line is a real design order line: the design link exists.
      const query: any = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data: links } = await query.graph({
        entity: "design_line_item",
        filters: { line_item_id: out.added_line_item_ids },
        fields: ["design_id", "line_item_id"],
      })
      expect(links.map((l: any) => l.design_id).sort()).toEqual([trouserId, shirtId].sort())

      // Adding the same design twice is refused.
      const dup = await api
        .post(`/admin/designs/orders/${anchor}/items`, { add_design_ids: [trouserId] }, adminHeaders)
        .catch((e: any) => e.response)
      expect(dup.status).toBe(400)
      expect(dup.data.reason).toBe("already_in_order")

      // Removing a line takes it off the total and frees its design.
      const trouserLine = links.find((l: any) => l.design_id === trouserId).line_item_id
      const removed = await api.post(
        `/admin/designs/orders/${anchor}/items`,
        { remove_line_item_ids: [trouserLine] },
        adminHeaders
      )
      expect(removed.status).toBe(200)
      const after = await readCart(cartId)
      expect(after.items).toHaveLength(2)
      expect(Number(after.total)).toBeCloseTo(14700, 2)

      // Removing every remaining line is a cancel, not an amend.
      const empty = await api
        .post(
          `/admin/designs/orders/${anchor}/items`,
          { remove_line_item_ids: await lineIds(cartId) },
          adminHeaders
        )
        .catch((e: any) => e.response)
      expect(empty.status).toBe(400)
      expect(empty.data.reason).toBe("would_empty")
    })

    it("refuses once a deposit is set", async () => {
      const other = await api.post(
        "/admin/designs/draft-order",
        { design_ids: [trouserId], currency_code: "inr", country_code: "in" },
        adminHeaders
      )
      const [anchor] = await lineIds(other.data.cart.id)
      await api.post(`/admin/designs/orders/${anchor}/deposit`, { deposit_pct: 10 }, adminHeaders)
      const refused = await api
        .post(`/admin/designs/orders/${anchor}/items`, { add_design_ids: [designId] }, adminHeaders)
        .catch((e: any) => e.response)
      expect(refused.status).toBe(409)
      expect(refused.data.reason).toBe("has_deposit")
    })
  })
})
