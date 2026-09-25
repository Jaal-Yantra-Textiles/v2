/**
 * #2262, founder decision A — `reverse-work-order-fees` flips the accrued 2%
 * commission on a PROVEN work order to `reversed`, and touches nothing else.
 *
 * Seeds three fees:
 *   - a commission on a real design work order (built through the admin API, so
 *     the mirror carries its order↔production_run link) → REVERSED
 *   - a commission on a plain partner-linked order with no execution link
 *     → left alone, reported
 *   - a retail_split fee on that same kind of order → untouched
 * and proves a dry run writes nothing.
 */
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createOrderWorkflow } from "@medusajs/core-flows"
import { reverseWorkOrderFeesJob } from "../../src/api/admin/ops/maintenance-jobs/reverse-work-order-fees-job"
import { PARTNER_BILLING_MODULE } from "../../src/modules/partner_billing"
import { PARTNER_MODULE } from "../../src/modules/partner"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { ensureHouseStoreRegion } from "../helpers/ensure-house-store-region"
import { seedCommissionFee } from "../helpers/seed-partner-fee"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(90000)

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("reverse-work-order-fees job (#2262 A)", () => {
    const post = async (url: string, body: any, cfg?: any) => {
      try {
        return await api.post(url, body, cfg)
      } catch (err: any) {
        throw new Error(`POST ${url} failed: ${err?.response?.status} ${JSON.stringify(err?.response?.data)}`)
      }
    }

    it("reverses commission on a proven work order only; a dry run writes nothing", async () => {
      const container = getContainer()
      const unique = Date.now()
      await createAdminUser(container)
      await ensureHouseStoreRegion(container)
      const adminHeaders = await getAuthHeaders(api)

      // A partner (admin route — no partner login needed here).
      const partner = await post(
        "/admin/partners",
        { partner: { name: `Fee Rev ${unique}`, handle: `fee-rev-${unique}` }, admin: { email: `fee-rev-${unique}@jyt.test`, first_name: "F", last_name: "R" } },
        adminHeaders
      )
      const partnerId = partner.data.partner.id

      // 1) A real design work order → its mirror has the order↔run link.
      const design = await post(
        "/admin/designs",
        { name: `Fee Rev Design ${unique}`, description: "d", design_type: "Original", status: "Approved", priority: "Medium" },
        adminHeaders
      )
      const tpl = `fee-rev-${unique}`
      await post(
        "/admin/task-templates",
        { name: tpl, description: "t", priority: "medium", estimated_duration: 60, required_fields: {}, eventable: false, notifiable: false, message_template: "", metadata: { workflow_type: "production_run" }, category: "Fee Rev" },
        adminHeaders
      )
      const runs = await post(
        `/admin/designs/${design.data.design.id}/production-runs`,
        { assignments: [{ partner_id: partnerId, quantity: 2, role: "manufacturing", template_names: [tpl] }] },
        adminHeaders
      )
      const runId = runs.data.children?.[0]?.id ?? runs.data.result?.children?.[0]?.id
      const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
      const { data: runRows } = await query.graph({ entity: "production_runs", filters: { id: runId }, fields: ["order.id"] })
      const workOrderId = runRows[0].order.id
      const workFee = await seedCommissionFee(container, partnerId, workOrderId)

      // 2) + 3) A plain partner-linked order with NO execution link.
      const { result: plain } = await createOrderWorkflow(container).run({
        input: { currency_code: "inr", email: `plain-${unique}@jyt.test`, items: [{ title: "x", quantity: 1, unit_price: 1000 } as any] } as any,
      })
      const link: any = container.resolve(ContainerRegistrationKeys.LINK)
      await link.create([{ [PARTNER_MODULE]: { partner_id: partnerId }, [Modules.ORDER]: { order_id: (plain as any).id } }])
      const plainFee = await seedCommissionFee(container, partnerId, (plain as any).id)
      const billing: any = container.resolve(PARTNER_BILLING_MODULE)
      const { result: plain2 } = await createOrderWorkflow(container).run({
        input: { currency_code: "inr", email: `plain2-${unique}@jyt.test`, items: [{ title: "y", quantity: 1, unit_price: 500 } as any] } as any,
      })
      const [retailFee] = await billing.createPartnerFees([
        { partner_id: partnerId, order_id: (plain2 as any).id, order_total: 500, currency_code: "inr", fee_basis: "percentage", fee_rate: 1700, fee_amount: 85, fee_type: "retail_split", status: "accrued", accrued_at: new Date() },
      ])

      const statusOf = async (id: string) => (await billing.retrievePartnerFee(id)).status

      // Dry run: reports, writes nothing.
      const preview = await reverseWorkOrderFeesJob.run(container, { dry_run: true, params: {} })
      expect(preview.changes.map((c) => c.id)).toEqual([workFee.id])
      expect(preview.errors?.map((e) => e.id)).toEqual([plainFee.id])
      expect(preview.applied).toBe(false)
      expect(await statusOf(workFee.id)).toBe("accrued")

      // Apply.
      const applied = await reverseWorkOrderFeesJob.run(container, { dry_run: false, params: {} })
      expect(applied.applied).toBe(true)
      const reversed = await billing.retrievePartnerFee(workFee.id)
      expect(reversed.status).toBe("reversed")
      expect(reversed.metadata?.reversed_reason).toBe("work_order_no_commission")
      expect(await statusOf(plainFee.id)).toBe("accrued")
      expect(await statusOf(retailFee.id)).toBe("accrued")

      // Re-run: nothing left to reverse.
      const again = await reverseWorkOrderFeesJob.run(container, { dry_run: false, params: {} })
      expect(again.changes).toEqual([])
      expect(again.applied).toBe(false)
    })
  })
})
