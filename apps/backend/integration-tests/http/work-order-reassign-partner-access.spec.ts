/**
 * #2265 S3b — a run reassigned away from a partner takes its work order with it.
 *
 * The run moves (partner_id A → B), but partner access to the WORK ORDER is
 * decided by the partner↔order link alone (listPartnerWorkOrderIds,
 * validatePartnerOrderOwnership). Nothing dismissed A's link, so A kept
 * listing and opening a work order that was now B's.
 *
 * Runs with WORK_ORDER_READS on, as prod does since 2026-09-25.
 */
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { ensureHouseStoreRegion } from "../helpers/ensure-house-store-region"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import partnerOrderLink from "../../src/links/partner-order"
import { createProductionRunWorkflow } from "../../src/workflows/production-runs/create-production-run"
import { reconcileWorkOrderPartnerLinksJob } from "../../src/api/admin/ops/maintenance-jobs/work-order-jobs"
import { PARTNER_MODULE } from "../../src/modules/partner"

jest.setTimeout(120000)

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Work order access follows a reassigned run (#2265 S3b)", () => {
    let adminHeaders: any
    let unique: number
    const previousFlag = process.env.WORK_ORDER_READS

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
      const email = `wo-reassign-${label}-${unique}@jyt.test`
      const password = "supersecret"
      await post("/auth/partner/emailpass/register", { email, password })
      const first = await post("/auth/partner/emailpass", { email, password })
      const res = await post(
        "/partners",
        {
          name: `WO Reassign ${label} ${unique}`,
          handle: `wo-reassign-${label}-${unique}`,
          admin: { email, first_name: "Test", last_name: "Partner" },
        },
        { headers: { Authorization: `Bearer ${first.data.token}` } }
      )
      const fresh = await post("/auth/partner/emailpass", { email, password })
      return {
        partnerId: res.data.partner.id as string,
        headers: { headers: { Authorization: `Bearer ${fresh.data.token}` } },
      }
    }

    const createTemplate = async () => {
      const name = `wo-reassign-${unique}`
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
          category: "WO Reassign Test",
        },
        adminHeaders
      )
      return name
    }

    /** A design + an approved child run assigned to `partnerId`. */
    const createAssignedRun = async (partnerId: string) => {
      const design = await post(
        "/admin/designs",
        { name: `WO Reassign ${unique}`, design_type: "Original", status: "Approved", priority: "Medium" },
        adminHeaders
      )
      const parent = await post(
        "/admin/production-runs",
        { design_id: design.data.design.id, quantity: 3 },
        adminHeaders
      )
      const approve = await post(
        `/admin/production-runs/${parent.data.production_run.id}/approve`,
        { assignments: [{ partner_id: partnerId, role: "stitching", quantity: 3 }] },
        adminHeaders
      )
      const child = (approve.data.result?.children || []).find(
        (c: any) => (c?.partner_id ?? c?.partnerId) === partnerId
      )
      expect(child?.id).toBeTruthy()
      return child.id as string
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

    const linkedPartners = async (orderId: string) => {
      const query: any = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: partnerOrderLink.entryPoint,
        filters: { order_id: orderId },
        fields: ["partner_id"],
      })
      return (data ?? []).map((l: any) => l.partner_id).sort()
    }

    const listedFor = async (headers: any) => {
      const res = await api.get("/partners/orders?kind=design&limit=100", headers)
      return (res.data.orders || []).map((o: any) => String(o.id))
    }

    const openFor = async (orderId: string, headers: any) =>
      (await api.get(`/partners/orders/${orderId}`, headers).catch((e: any) => e.response)).status

    beforeAll(() => {
      process.env.WORK_ORDER_READS = "true"
    })
    afterAll(() => {
      if (previousFlag === undefined) delete process.env.WORK_ORDER_READS
      else process.env.WORK_ORDER_READS = previousFlag
    })

    beforeEach(async () => {
      unique = Date.now()
      await createAdminUser(getContainer())
      adminHeaders = await getAuthHeaders(api)
      // Without a house-store region the mirror refuses to project a work order.
      await ensureHouseStoreRegion(getContainer())
    })

    it("partner A loses the work order once the run is reassigned to B", async () => {
      const template = await createTemplate()
      const a = await createPartner("a")
      const b = await createPartner("b")
      const runId = await createAssignedRun(a.partnerId)

      await post(`/admin/production-runs/${runId}/send-to-production`, { template_names: [template] }, adminHeaders)
      const orderId = await workOrderOf(runId)
      expect(orderId).toBeTruthy()
      expect(await listedFor(a.headers)).toContain(orderId)

      // Prod path: A declines → parked → admin hands it to B → dispatched to B.
      await post(`/partners/production-runs/${runId}/decline`, { reason: "capacity" }, a.headers)
      await post(`/admin/production-runs/${runId}/assign-partner`, { partner_id: b.partnerId }, adminHeaders)
      await post(`/admin/production-runs/${runId}/send-to-production`, { template_names: [template] }, adminHeaders)

      // The run stays on the same work order, now B's.
      expect(await workOrderOf(runId)).toBe(orderId)
      expect(await listedFor(b.headers)).toContain(orderId)
      expect(await openFor(orderId!, b.headers)).toBe(200)

      // …and A no longer has it.
      expect({
        listed: (await listedFor(a.headers)).includes(orderId!),
        opens: await openFor(orderId!, a.headers),
      }).toEqual({ listed: false, opens: 404 })
      expect(await linkedPartners(orderId!)).toEqual([b.partnerId])
    })

    it("an admin reassigning a dispatched run straight to B also removes A", async () => {
      const template = await createTemplate()
      const a = await createPartner("direct-a")
      const b = await createPartner("direct-b")
      const runId = await createAssignedRun(a.partnerId)

      await post(`/admin/production-runs/${runId}/send-to-production`, { template_names: [template] }, adminHeaders)
      const orderId = await workOrderOf(runId)
      expect(await listedFor(a.headers)).toContain(orderId)

      // No decline: the admin corrects the partner before A accepted.
      await post(`/admin/production-runs/${runId}/assign-partner`, { partner_id: b.partnerId }, adminHeaders)

      expect({
        listed: (await listedFor(a.headers)).includes(orderId!),
        opens: await openFor(orderId!, a.headers),
      }).toEqual({ listed: false, opens: 404 })

      // Until B is sent the run, the work order is nobody's — and
      // work_order.partner_id (copied from the first link) must not still name A.
      expect(await linkedPartners(orderId!)).toEqual([])
      const query: any = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data: wo } = await query.graph({
        entity: "work_order",
        filters: { id: orderId },
        fields: ["id", "partner_id"],
      })
      expect(wo?.[0]?.partner_id ?? null).toBeNull()
    })

    it("keeps A on a shared work order while A still has another run on it", async () => {
      const template = await createTemplate()
      const a = await createPartner("shared-a")
      const b = await createPartner("shared-b")
      const customerOrderId = `order_customer_${unique}`

      // Two customer-order runs for A collate into ONE work order on dispatch.
      const place = async (n: number) => {
        const design = await post(
          "/admin/designs",
          { name: `WO Shared ${n} ${unique}`, design_type: "Original", status: "Approved", priority: "Medium" },
          adminHeaders
        )
        const { result } = await createProductionRunWorkflow(getContainer()).run({
          input: {
            design_id: design.data.design.id,
            quantity: 2,
            order_id: customerOrderId,
            order_line_item_id: `ordli_${design.data.design.id}`,
            skip_unified_projection: true,
            metadata: { source: "order.placed" },
          } as any,
        })
        const runId = ((result as any).production_run?.id ?? (result as any).id) as string
        const service: any = getContainer().resolve("production_runs")
        await service.updateProductionRuns({ id: runId, partner_id: a.partnerId, status: "approved" })
        await post(`/admin/production-runs/${runId}/send-to-production`, { template_names: [template] }, adminHeaders)
        return runId
      }
      const run1 = await place(1)
      const run2 = await place(2)
      const orderId = await workOrderOf(run1)
      expect(orderId).toBeTruthy()
      expect(await workOrderOf(run2)).toBe(orderId)

      await post(`/admin/production-runs/${run2}/assign-partner`, { partner_id: b.partnerId }, adminHeaders)

      // run1 is still A's, so A keeps the work order.
      expect(await linkedPartners(orderId!)).toContain(a.partnerId)
      expect(await listedFor(a.headers)).toContain(orderId)
      expect(await openFor(orderId!, a.headers)).toBe(200)
    })

    it("the cleanup job removes a stale link left by an old reassignment, and only that", async () => {
      const template = await createTemplate()
      const a = await createPartner("job-a")
      const old = await createPartner("job-old")
      const runId = await createAssignedRun(a.partnerId)
      await post(`/admin/production-runs/${runId}/send-to-production`, { template_names: [template] }, adminHeaders)
      const orderId = (await workOrderOf(runId))!

      // What a reassignment before this fix left behind: a link for a partner
      // who holds no run on the work order.
      const remoteLink: any = getContainer().resolve(ContainerRegistrationKeys.LINK)
      await remoteLink.create([
        { [PARTNER_MODULE]: { partner_id: old.partnerId }, [Modules.ORDER]: { order_id: orderId } },
      ])
      expect(await listedFor(old.headers)).toContain(orderId)

      const preview = await reconcileWorkOrderPartnerLinksJob.run(getContainer(), {
        dry_run: true,
        params: { order_ids: orderId },
      })
      expect(preview.changes.map((c) => c.id)).toEqual([`${orderId}:${old.partnerId}`])
      expect((await linkedPartners(orderId)).sort()).toEqual([a.partnerId, old.partnerId].sort())

      const applied = await reconcileWorkOrderPartnerLinksJob.run(getContainer(), {
        dry_run: false,
        params: { order_ids: orderId },
      })
      expect(applied.applied).toBe(true)
      expect(await linkedPartners(orderId)).toEqual([a.partnerId])
      expect(await listedFor(old.headers)).not.toContain(orderId)
      expect(await listedFor(a.headers)).toContain(orderId)

      const again = await reconcileWorkOrderPartnerLinksJob.run(getContainer(), {
        dry_run: false,
        params: { order_ids: orderId },
      })
      expect(again.changes).toEqual([])

      // The default run — every design work order, plus the 2+ partner count.
      const full = await reconcileWorkOrderPartnerLinksJob.run(getContainer(), { dry_run: true, params: {} })
      expect(full.errors).toEqual([])
      expect(full.summary).toMatch(/\d+ work order\(s\) \(design \+ inventory\) have 2\+ partner links/)
      expect(full.changes.filter((c) => c.id.startsWith(orderId))).toEqual([])
    })
  })
})
