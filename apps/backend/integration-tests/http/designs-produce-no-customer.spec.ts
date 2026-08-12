import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { IRegionModuleService } from "@medusajs/types"

import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { produceDesignsAsWorkOrder } from "../../src/workflows/designs/produce-designs-as-work-order"
import { PRODUCTION_RUNS_MODULE } from "../../src/modules/production_runs"
import { PARTNER_MODULE } from "../../src/modules/partner"
import partnerOrderLink from "../../src/links/partner-order"
import designPartnerLink from "../../src/links/design-partners-link"

jest.setTimeout(90 * 1000)

/**
 * #826 — produceDesignsAsWorkOrder is the "Send to Production" path from the
 * designs list: pick N designs + a partner → one production run per design (born
 * sent_to_partner, NO commissioning order) collated into ONE kind=design
 * work-order the partner sees. The design analog of an inventory order, with no
 * customer/sale attached.
 */
setupSharedTestSuite(() => {
  describe("#826 — send designs to production (no customer)", () => {
    let adminHeaders: { headers: Record<string, string> }
    let regionId: string
    let designIds: string[] = []
    let partnerId: string

    const { api, getContainer } = getSharedTestEnv()

    beforeAll(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)

      const regionsRes = await api.get("/admin/regions", adminHeaders)
      if (regionsRes.data.regions?.length) {
        regionId = regionsRes.data.regions[0].id
      } else {
        const regionService = container.resolve(
          Modules.REGION
        ) as IRegionModuleService
        const region = await regionService.createRegions({
          name: "Produce No-Customer Region",
          currency_code: "inr",
          countries: ["in"],
        })
        regionId = region.id
      }

      const partnerService: any = container.resolve(PARTNER_MODULE)
      const unique = Date.now()
      const partner = await partnerService.createPartners({
        name: `Produce NoCust Partner ${unique}`,
        handle: `produce-nocust-${unique}`,
      })
      partnerId = partner.id

      for (let i = 0; i < 3; i++) {
        const res = await api.post(
          "/admin/designs",
          {
            name: `Produce NoCust Design ${unique}-${i}`,
            description: "produce no-customer test",
            design_type: "Original",
            status: "Approved",
            priority: "Medium",
            estimated_cost: 100 + i * 40,
          },
          adminHeaders
        )
        expect(res.status).toBe(201)
        designIds.push(res.data.design.id)
      }
    })

    it("creates one partner-facing run per design and collates them into ONE work-order (no commissioning order)", async () => {
      const container = getContainer()

      const result = await produceDesignsAsWorkOrder(
        container,
        designIds,
        partnerId
      )
      expect(result.created).toBe(designIds.length)
      expect(result.design_ids.sort()).toEqual([...designIds].sort())
      expect(result.work_order_id).toBeTruthy()
      const workOrderId = result.work_order_id!

      // Each run is partner-facing (sent_to_partner) and carries NO commissioning
      // order_id (there is no sale) — that's the whole point of this path.
      const runService: any = container.resolve(PRODUCTION_RUNS_MODULE)
      const runs = await runService.listProductionRuns(
        { id: result.run_ids },
        { select: ["id", "design_id", "order_id", "partner_id", "status"] }
      )
      expect(runs).toHaveLength(designIds.length)
      for (const run of runs) {
        expect(designIds).toContain(run.design_id)
        expect(run.partner_id).toBe(partnerId)
        expect(run.status).toBe("sent_to_partner")
        expect(run.order_id).toBeFalsy()
      }

      // The collated work-order: N lines, kind=design, and explicitly no source
      // (commissioning) order.
      const orderService: any = container.resolve(Modules.ORDER)
      const workOrder = await orderService.retrieveOrder(workOrderId, {
        relations: ["items"],
      })
      expect(workOrder.items).toHaveLength(designIds.length)
      expect(workOrder.metadata?.collated_design_order).toBe(true)
      expect(workOrder.metadata?.source_order_id).toBeNull()

      // order↔run 1:many — all runs link to that ONE work-order.
      const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
      const { data: wo } = await query.graph({
        entity: "orders",
        fields: ["id", "production_runs.id"],
        filters: { id: workOrderId },
      })
      const linkedRunIds = (wo?.[0]?.production_runs || []).map((x: any) => x.id)
      expect(linkedRunIds.sort()).toEqual(
        [...result.run_ids].sort()
      )

      // partner↔order (D3) — the committed partner can see the work-order. Read
      // the link table directly by entryPoint (the source of truth, same as
      // list-partner-orders), not via a graph accessor.
      const { data: partnerLinks } = await query.graph({
        entity: partnerOrderLink.entryPoint,
        fields: ["partner_id", "order_id"],
        filters: { order_id: workOrderId },
      })
      const partnerLinkIds = (partnerLinks ?? []).map((r: any) => r.partner_id)
      expect(partnerLinkIds).toContain(partnerId)

      // design↔partner link per design — without it partner-ui design-details
      // (`GET /partners/designs/:id`) 404s "Design not found for this partner"
      // (the "nothing found" bug). Every produced design must be assigned.
      const { data: designPartnerLinks } = await query.graph({
        entity: designPartnerLink.entryPoint,
        fields: ["design_id", "partner_id"],
        filters: { partner_id: partnerId },
      })
      const assignedDesignIds = (designPartnerLinks ?? []).map(
        (r: any) => r.design_id
      )
      for (const designId of designIds) {
        expect(assignedDesignIds).toContain(designId)
      }
    })

    /**
     * #1263 — this path used to stop at creation. Runs were born
     * `sent_to_partner` and no task template was ever instantiated, so the
     * partner was handed work with nothing to accept while the record claimed
     * it had been sent — the same "the record says one thing and the work says
     * another" class as #1261.
     */
    describe("dispatching the batch (#1263)", () => {
      const createTemplate = async (suffix: string, category: string) => {
        const res = await api.post(
          "/admin/task-templates",
          {
            name: `produce-batch-${suffix}-${Date.now()}`,
            description: "produce batch step",
            priority: "medium",
            estimated_duration: 30,
            eventable: false,
            notifiable: false,
            metadata: { workflow_type: "production_run" },
            category,
          },
          adminHeaders
        )
        expect(res.status).toBe(201)
        return res.data.task_template.id as string
      }

      const createDesign = async (label: string) => {
        const res = await api.post(
          "/admin/designs",
          {
            name: `Produce Batch ${label} ${Date.now()}`,
            description: "produce batch test",
            design_type: "Original",
            status: "Approved",
            priority: "Medium",
          },
          adminHeaders
        )
        expect(res.status).toBe(201)
        return res.data.design.id as string
      }

      it("dispatches each design with ITS OWN templates", async () => {
        const container = getContainer()
        const templateA = await createTemplate("cut", "Pre Production")
        const templateB = await createTemplate("stitch", "Production")
        const batchDesignIds = [
          await createDesign("A"),
          await createDesign("B"),
        ]

        const result = await produceDesignsAsWorkOrder(
          container,
          batchDesignIds,
          partnerId,
          {
            // Per design, not pooled: the #1261 recovery found 7 runs using 4
            // different sets, so one batch-wide selection would be wrong for
            // most of them.
            selections: [
              { design_id: batchDesignIds[0], template_ids: [templateA] },
              { design_id: batchDesignIds[1], template_ids: [templateB] },
            ],
          }
        )

        expect(result.created).toBe(2)
        expect(result.not_dispatched).toEqual([])
        expect([...result.dispatched].sort()).toEqual(
          [...batchDesignIds].sort()
        )

        const expected = new Map([
          [batchDesignIds[0], templateA],
          [batchDesignIds[1], templateB],
        ])

        const runService: any = container.resolve(PRODUCTION_RUNS_MODULE)
        const runs = await runService.listProductionRuns(
          { id: result.run_ids },
          { select: ["id", "design_id", "status", "dispatched_template_ids"] }
        )
        expect(runs).toHaveLength(2)
        for (const run of runs) {
          expect(run.status).toBe("sent_to_partner")
          // The whole point: the run now records what it was dispatched with.
          expect(run.dispatched_template_ids).toEqual([
            expected.get(run.design_id),
          ])
        }

        // And the partner has something to accept — the old path created none.
        const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
        for (const runId of result.run_ids) {
          const { data } = await query.graph({
            entity: "production_runs",
            fields: ["id", "tasks.id"],
            filters: { id: runId },
          })
          expect((data?.[0]?.tasks || []).length).toBeGreaterThan(0)
        }
      })

      it("previews the design → templates plan without creating anything", async () => {
        const container = getContainer()
        const templateA = await createTemplate("dry", "Production")
        const designId = await createDesign("Dry")

        const result = await produceDesignsAsWorkOrder(
          container,
          [designId],
          partnerId,
          { templateIds: [templateA], dryRun: true }
        )

        expect(result.dry_run).toBe(true)
        expect(result.created).toBe(0)
        expect(result.run_ids).toEqual([])
        expect(result.work_order_id).toBeNull()
        expect(result.designs).toEqual([
          expect.objectContaining({
            design_id: designId,
            template_ids: [templateA],
            dispatched: false,
          }),
        ])

        const runService: any = container.resolve(PRODUCTION_RUNS_MODULE)
        const runs = await runService.listProductionRuns(
          { design_id: designId },
          { select: ["id"] }
        )
        expect(runs).toHaveLength(0)
      })

      it("reports a design left with no templates instead of silently creating a taskless run", async () => {
        const container = getContainer()
        const designId = await createDesign("NoTemplates")

        const result = await produceDesignsAsWorkOrder(
          container,
          [designId],
          partnerId
        )

        // Backwards compatible — the run is still created, as before. What is
        // new is that the caller is told it carries no tasks.
        expect(result.created).toBe(1)
        expect(result.dispatched).toEqual([])
        expect(result.not_dispatched).toEqual([
          expect.objectContaining({
            design_id: designId,
            dispatched: false,
            reason: expect.stringContaining("no templates selected"),
          }),
        ])
      })
    })
  })
})
