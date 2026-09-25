/**
 * #2281 — a customer-order run gets a work-order when it is DISPATCHED.
 *
 * `order.placed` creates runs with `skip_unified_projection` (#1126): unassigned,
 * they are "sold, not yet made" and belong on no work-order. On prod 2026-09-25
 * four such runs were dispatched to Ksaman and landed on no order at all, so
 * Ksaman's portal listed nothing. Dispatch now projects them — one work-order
 * per (customer order, partner) — and `collate-customer-order-runs` repairs
 * runs dispatched before that.
 */
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { ensureHouseStoreRegion } from "../helpers/ensure-house-store-region"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createProductionRunWorkflow } from "../../src/workflows/production-runs/create-production-run"
import { collateCustomerOrderRunsJob } from "../../src/api/admin/ops/maintenance-jobs/collate-customer-order-runs-job"

jest.setTimeout(120000)

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Customer-order runs get a work-order on dispatch (#2281)", () => {
    let adminHeaders: any
    let unique: number

    const post = async (url: string, body: any, cfg?: any) => {
      try {
        return await api.post(url, body, cfg)
      } catch (err: any) {
        throw new Error(
          `POST ${url} failed: ${err?.response?.status} ${JSON.stringify(err?.response?.data)}`
        )
      }
    }

    const createPartner = async (label: string) => {
      const email = `co-run-${label}-${unique}@jyt.test`
      const password = "supersecret"
      await post("/auth/partner/emailpass/register", { email, password })
      const firstLogin = await post("/auth/partner/emailpass", { email, password })
      const res = await post(
        "/partners",
        {
          name: `Customer Order Run Partner ${label} ${unique}`,
          handle: `co-run-${label}-${unique}`,
          admin: { email, first_name: "Test", last_name: "Partner" },
        },
        { headers: { Authorization: `Bearer ${firstLogin.data.token}` } }
      )
      const fresh = await post("/auth/partner/emailpass", { email, password })
      return {
        partnerId: res.data.partner.id as string,
        partnerHeaders: { headers: { Authorization: `Bearer ${fresh.data.token}` } },
      }
    }

    const createTemplate = async () => {
      const name = `co-run-${unique}`
      await post(
        "/admin/task-templates",
        {
          name,
          description: "template",
          priority: "medium",
          estimated_duration: 60,
          required_fields: {},
          eventable: false,
          notifiable: false,
          message_template: "",
          metadata: { workflow_type: "production_run" },
          category: "Customer Order Run Test",
        },
        adminHeaders
      )
      return name
    }

    const createDesign = async (n: number) => {
      const res = await post(
        "/admin/designs",
        {
          name: `Customer Order Design ${n} ${unique}`,
          design_type: "Original",
          status: "Approved",
          priority: "Medium",
        },
        adminHeaders
      )
      return res.data.design.id as string
    }

    // What order.placed does (subscribers/order-placed.ts).
    const placeRun = async (designId: string, orderId: string, quantity = 2) => {
      const { result } = await createProductionRunWorkflow(getContainer()).run({
        input: {
          design_id: designId,
          quantity,
          order_id: orderId,
          order_line_item_id: `ordli_${designId}`,
          skip_unified_projection: true,
          metadata: { source: "order.placed" },
        } as any,
      })
      return ((result as any).production_run?.id ?? (result as any).id) as string
    }

    const assign = async (runId: string, partnerId: string, status = "approved") => {
      const service: any = getContainer().resolve("production_runs")
      await service.updateProductionRuns({ id: runId, partner_id: partnerId, status })
    }

    const workOrderOf = async (runId: string) => {
      const query: any = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "production_runs",
        filters: { id: runId },
        fields: ["id", "order.id"],
      })
      return (data?.[0]?.order?.id ?? null) as string | null
    }

    const itemsOf = async (orderId: string) => {
      const query: any = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "order",
        filters: { id: orderId },
        fields: ["id", "items.id", "items.metadata"],
      })
      return (data?.[0]?.items ?? []) as any[]
    }

    beforeEach(async () => {
      const container = getContainer()
      unique = Date.now()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)
      const regionService: any = container.resolve(Modules.REGION)
      await regionService.createRegions({ name: "India", currency_code: "inr", countries: ["in"] })
      await ensureHouseStoreRegion(container)
    })

    it("collates one work-order per (customer order, partner) on dispatch, and leaves unassigned runs alone", async () => {
      const customerOrderId = `order_customer_${unique}`
      const template = await createTemplate()
      const a = await createPartner("a")
      const b = await createPartner("b")

      const designA1 = await createDesign(1)
      const designA2 = await createDesign(2)
      const runA1 = await placeRun(designA1, customerOrderId, 3)
      const runA2 = await placeRun(designA2, customerOrderId)
      const runB = await placeRun(await createDesign(3), customerOrderId)
      const unassigned = await placeRun(await createDesign(4), customerOrderId)

      // #1126 still holds at placement: no run is on a work-order.
      for (const id of [runA1, runA2, runB, unassigned]) {
        expect(await workOrderOf(id)).toBeNull()
      }

      await assign(runA1, a.partnerId)
      await assign(runA2, a.partnerId)
      await assign(runB, b.partnerId)
      for (const id of [runA1, runA2, runB]) {
        await post(`/admin/production-runs/${id}/send-to-production`, { template_names: [template] }, adminHeaders)
      }

      const orderA = await workOrderOf(runA1)
      expect(orderA).toBeTruthy()
      // 🔑 The second run for the same partner JOINS — one order, two lines.
      expect(await workOrderOf(runA2)).toBe(orderA)
      const lines = await itemsOf(orderA!)
      expect(lines.map((l) => l.metadata?.production_run_id).sort()).toEqual([runA1, runA2].sort())

      // Another partner on the same customer order gets their own.
      const orderB = await workOrderOf(runB)
      expect(orderB).toBeTruthy()
      expect(orderB).not.toBe(orderA)

      // Still "sold, not yet made" — no partner, no order.
      expect(await workOrderOf(unassigned)).toBeNull()

      // The partner can see it — the prod symptom.
      const listA = await api.get("/partners/orders?kind=design&limit=100", a.partnerHeaders)
      const idsA = (listA.data.orders || []).map((o: any) => String(o.id))
      expect(idsA).toContain(String(orderA))
      expect(idsA).not.toContain(String(orderB))

      // The partner can open EVERY design on the order — including the FIRST
      // run's, which minted the order. Prod: Oshen Tea Towels 404'd on #116.
      for (const designId of [designA1, designA2]) {
        const page = await api
          .get(`/partners/designs/${designId}`, a.partnerHeaders)
          .catch((e: any) => e.response)
        expect({ designId, status: page.status }).toEqual({ designId, status: 200 })
      }
    })

    it("collate-customer-order-runs repairs runs dispatched before the hook", async () => {
      const customerOrderId = `order_repair_${unique}`
      const a = await createPartner("repair")
      const run1 = await placeRun(await createDesign(5), customerOrderId)
      const run2 = await placeRun(await createDesign(6), customerOrderId)
      const neverSent = await placeRun(await createDesign(7), customerOrderId)
      // Dispatched the old way: status moved, no projection ran.
      await assign(run1, a.partnerId, "sent_to_partner")
      await assign(run2, a.partnerId, "sent_to_partner")
      await assign(neverSent, a.partnerId, "approved")

      const container = getContainer()
      const preview = await collateCustomerOrderRunsJob.run(container, {
        dry_run: true,
        params: { order_ids: customerOrderId },
      } as any)
      expect(preview.changes.map((c) => c.id).sort()).toEqual([run1, run2].sort())
      expect(await workOrderOf(run1)).toBeNull()

      const applied = await collateCustomerOrderRunsJob.run(container, {
        dry_run: false,
        params: { order_ids: customerOrderId },
      } as any)
      expect(applied.applied).toBe(true)
      const order = await workOrderOf(run1)
      expect(order).toBeTruthy()
      expect(await workOrderOf(run2)).toBe(order)
      expect(await workOrderOf(neverSent)).toBeNull()

      // Idempotent: a second apply finds nothing to do.
      const again = await collateCustomerOrderRunsJob.run(container, {
        dry_run: true,
        params: { order_ids: customerOrderId },
      } as any)
      expect(again.changes).toHaveLength(0)
    })
  })
})
