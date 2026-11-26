import { createTaxRegionsWorkflow, refundPaymentWorkflow } from "@medusajs/medusa/core-flows"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { reinstateBalanceFromCreditLineJob } from "../../src/api/admin/ops/maintenance-jobs/reinstate-balance-from-credit-line-job"

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

    /**
     * Order #176 (2026-11-26): a 50% deposit order paid IN FULL, then half
     * refunded from the admin. Medusa books every refund on a not-overpaid
     * order as a CREDIT LINE, so the total dropped to what was kept and the
     * order read fully paid: the balance could never be raised. The job
     * reverses that credit line and re-states the schedule.
     */
    it("reinstate-balance-from-credit-line turns the refund credit back into a balance owed", async () => {
      const container = getContainer()
      const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
      const cartId = await newCart()
      const carts: any = container.resolve(Modules.CART)
      const [line] = await carts.listLineItems({ cart_id: cartId })
      expect(
        (await api.post(`/admin/designs/orders/${line.id}/deposit`, { deposit_pct: 50 }, adminHeaders)).status
      ).toBe(200)

      // Paid in full (what #176's buyer was charged).
      const conv = await api
        .post(`/admin/designs/orders/${line.id}/convert`, { payment_mode: "prepaid" }, adminHeaders)
        .catch((e: any) => e.response)
      if (conv.status !== 200) throw new Error(`convert ${conv.status}: ${JSON.stringify(conv.data)}`)
      const orderId = conv.data.design_order_conversion.order_id

      const readOrder = async () =>
        (
          await query.graph({
            entity: "order",
            fields: [
              "id",
              "total",
              "summary",
              "credit_lines.id",
              "credit_lines.amount",
              "credit_lines.reference",
              "payment_collections.payments.id",
            ],
            filters: { id: orderId },
          })
        ).data[0]
      const placed = await readOrder()
      const total = Number(placed.total)
      const half = Math.round((total / 2) * 100) / 100

      // The schedule as #176's looked: the full charge recorded as the deposit.
      const schedules: any = container.resolve("payment_schedule")
      const sched = await schedules.findByCartId(cartId)
      await schedules.updatePaymentSchedules({
        id: sched.id,
        order_id: orderId,
        total_due: total,
        deposit_amount: total,
        deposit_status: "paid",
        balance_amount: 0,
        balance_status: "not_due",
      })

      // Half refunded from the admin: core adds a credit line.
      const paymentId = placed.payment_collections[0].payments[0].id
      await refundPaymentWorkflow(container).run({ input: { payment_id: paymentId, amount: half } })
      const refunded = await readOrder()
      const credit = refunded.credit_lines.find((c: any) => Number(c.amount) > 0)
      expect(credit).toBeTruthy() // the premise: the refund booked a credit line
      expect(Number(refunded.total)).toBeCloseTo(total - half, 2)
      expect(Number(refunded.summary.pending_difference)).toBeCloseTo(0, 2)

      const run = (dry_run: boolean) =>
        reinstateBalanceFromCreditLineJob.run(container as any, {
          dry_run,
          params: { order_id: orderId, credit_line_id: credit.id },
        } as any)

      // Preview writes nothing.
      const preview = await run(true)
      expect(preview.applied).toBe(false)
      expect(Number((await readOrder()).total)).toBeCloseTo(total - half, 2)

      const res = await run(false)
      expect(res.summary).toMatch(/^Done/)

      // Read the rows back.
      const after = await readOrder()
      expect(Number(after.total)).toBeCloseTo(total, 2)
      expect(Number(after.summary.pending_difference)).toBeCloseTo(total - half, 2)
      expect(after.credit_lines).toHaveLength(2) // original kept + its reversal
      const s2 = await schedules.findByOrderId(orderId)
      expect(Number(s2.deposit_amount)).toBeCloseTo(total - half, 2)
      expect(Number(s2.balance_amount)).toBeCloseTo(half, 2)
      expect(s2.balance_status).toBe("not_due")
      expect(s2.deposit_status).toBe("paid")

      // A second run is refused, not doubled.
      const again = await run(false)
      expect(again.summary).toMatch(/^REFUSED: .*already been reversed/)
      expect(Number((await readOrder()).total)).toBeCloseTo(total, 2)
    })
  })
})
