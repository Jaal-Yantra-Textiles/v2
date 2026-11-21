import { createTaxRegionsWorkflow } from "@medusajs/medusa/core-flows"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(60000)

/**
 * #2570 — record a deposit that arrived by bank transfer. Convert in
 * "deposit" mode captures only the deposit and leaves the balance owed.
 * (Setup borrowed from the #2564 — design-order PayU links expire. PayU sends no expiry event, so the
 * sweep job and the QR route are the only things that act on `expires_at`.
 * PayU itself is faked at `fetch`; the SQL, the cart metadata and the route
 * are real.
 */
setupSharedTestSuite(() => {
  describe("convert a design order with a manual deposit", () => {
    const { api, getContainer } = getSharedTestEnv()
    let adminHeaders: { headers: Record<string, string> }

    beforeAll(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)

      const { regions } = (await api.get("/admin/regions?limit=100", adminHeaders)).data
      const hasInr = (regions ?? []).some(
        (r: any) =>
          String(r.currency_code).toLowerCase() === "inr" &&
          (r.countries ?? []).some((c: any) => c.iso_2 === "in")
      )
      if (!hasInr) {
        await (container.resolve(Modules.REGION) as any).createRegions({
          name: "Expiry INR",
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

    })


    // One design per cart — a design can sit in only one open checkout.
    const newCart = async () => {
      const designId = (
        await api.post(
          "/admin/designs",
          {
            name: `Expiry Shirt ${Date.now()}-${Math.random()}`,
            description: "x",
            design_type: "Original",
            status: "Commerce_Ready",
            priority: "Medium",
            estimated_cost: 5000,
            cost_currency: "inr",
          },
          adminHeaders
        )
      ).data.design.id
      const res = await api
        .post(
          "/admin/designs/draft-order",
          { design_ids: [designId], currency_code: "inr", country_code: "in" },
          adminHeaders
        )
        .catch((e: any) => e.response)
      if (res.status !== 200) throw new Error(`draft-order ${res.status}: ${JSON.stringify(res.data)}`)
      return res.data.cart.id as string
    }


    it("captures only the 70% deposit, marks the schedule paid, leaves the balance owed", async () => {
      const cartId = await newCart()
      const carts: any = getContainer().resolve(Modules.CART)
      const [line] = await carts.listLineItems({ cart_id: cartId })
      const dep = await api.post(`/admin/designs/orders/${line.id}/deposit`, { deposit_pct: 70 }, adminHeaders)
      expect(dep.status).toBe(200)

      const res = await api
        .post(`/admin/designs/orders/${line.id}/convert`, { payment_mode: "deposit" }, adminHeaders)
        .catch((e: any) => e.response)
      if (res.status !== 200) throw new Error(`convert ${res.status}: ${JSON.stringify(res.data)}`)
      const out = res.data.design_order_conversion
      // 5000 + 5% GST = 5250 → 70% = 3675, balance 1575
      expect(out.deposit).toEqual(
        expect.objectContaining({ total: 5250, deposit_amount: 3675, balance_amount: 1575 })
      )

      // Read the rows back — the response is not the record.
      const query: any = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data: orders } = await query.graph({
        entity: "order",
        fields: ["id", "total", "payment_collections.amount", "payment_collections.status"],
        filters: { id: out.order_id },
      })
      const pcs = orders[0].payment_collections
      expect(pcs).toHaveLength(1)
      expect(Number(pcs[0].amount)).toBeCloseTo(3675, 2)

      const schedules: any = getContainer().resolve("payment_schedule")
      const row = await schedules.findByCartId(cartId)
      expect(row.deposit_status).toBe("paid")
      expect(row.order_id).toBe(out.order_id)
      expect(Number(row.balance_amount)).toBeCloseTo(1575, 2)
    })

    it("refuses a 'deposit' that is the whole total, and creates no order", async () => {
      const cartId = await newCart()
      const carts: any = getContainer().resolve(Modules.CART)
      const [line] = await carts.listLineItems({ cart_id: cartId })
      await api.post(`/admin/designs/orders/${line.id}/deposit`, { deposit_pct: 70 }, adminHeaders)
      const res = await api
        .post(
          `/admin/designs/orders/${line.id}/convert`,
          { payment_mode: "deposit", amount_received: 999999 },
          adminHeaders
        )
        .catch((e: any) => e.response)
      expect(res.status).toBeGreaterThanOrEqual(400)
      const [cart] = await carts.listCarts({ id: cartId }, { select: ["id", "metadata", "completed_at"] })
      expect(cart.completed_at).toBeNull()
      expect(cart.metadata?.converted_order_id).toBeUndefined()
    })
  })
})
