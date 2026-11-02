import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { IRegionModuleService } from "@medusajs/types"

import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { ensureHouseStoreRegion } from "../helpers/ensure-house-store-region"
import { produceDesignsAsWorkOrder } from "../../src/workflows/designs/produce-designs-as-work-order"
import { emitProductionRunReminderWorkflow } from "../../src/workflows/production-runs/emit-production-run-reminder"
import { findRunBundle } from "../../src/workflows/production-runs/lib/run-bundle"
import { PRODUCTION_RUNS_MODULE } from "../../src/modules/production_runs"
import { PARTNER_MODULE } from "../../src/modules/partner"
import partnerOrderLink from "../../src/links/partner-order"
import designPartnerLink from "../../src/links/design-partners-link"

jest.setTimeout(90 * 1000)

// #2500 — a garment design with no sizes is refused by produce; the fixtures
// that are not about sizes state one.
const ONE_SIZE = [{ size_label: "M", measurements: { chest: 40 } }]

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
      // The house store needs a region before anything can be stamped with one.
      await ensureHouseStoreRegion(container)
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
            size_sets: ONE_SIZE,
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
            size_sets: ONE_SIZE,
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

      it("tells the partner about the batch ONCE, not once per design (#2500)", async () => {
        const container = getContainer()
        const template = await createTemplate("bundle", "Production")
        const batchDesignIds = [
          await createDesign("Bundle A"),
          await createDesign("Bundle B"),
        ]

        // Every event the batch emits, from the workflows and from the caller.
        const eventBus: any = container.resolve(Modules.EVENT_BUS)
        const seen: { name: string; data: any }[] = []
        const originalEmit = eventBus.emit.bind(eventBus)
        const spy = jest.spyOn(eventBus, "emit").mockImplementation(async (...args: any[]) => {
          const list = Array.isArray(args[0]) ? args[0] : [args[0]]
          for (const e of list) {
            if (e?.name) seen.push({ name: e.name, data: e.data })
          }
          return originalEmit(...args)
        })

        let result: any
        try {
          result = await produceDesignsAsWorkOrder(container, batchDesignIds, partnerId, {
            selections: batchDesignIds.map((id) => ({ design_id: id, template_ids: [template] })),
          })
        } finally {
          spy.mockRestore()
        }

        expect(result.not_dispatched).toEqual([])
        expect(result.dispatched).toHaveLength(2)
        expect(result.work_order_id).toBeTruthy()

        // Each design's dispatch is quiet: it says "sent in a bundle", which
        // neither the WhatsApp flow nor the push listens to.
        const inBundle = seen.filter((e) => e.name === "production_run.sent_in_bundle")
        expect(inBundle.map((e) => e.data.production_run_id).sort()).toEqual(
          [...result.run_ids].sort()
        )
        expect(
          seen.filter(
            (e) => e.name === "production_run.sent_to_partner" && e.data?.bundle_fallback !== true
          )
        ).toEqual([])

        // And the batch is announced exactly once, naming its work order.
        const announced = seen.filter((e) => e.name === "work_order.sent_to_partner")
        expect(announced).toHaveLength(1)
        expect(announced[0].data.work_order_id).toBe(result.work_order_id)
        expect(announced[0].data.partner_id).toBe(partnerId)
        expect([...announced[0].data.production_run_ids].sort()).toEqual(
          [...result.run_ids].sort()
        )
      })

      it("reminds a bundle's design through the bundle, and a lone design on its own (#2500)", async () => {
        const container = getContainer()
        const template = await createTemplate("remind", "Production")
        const bundleDesigns = [await createDesign("Remind A"), await createDesign("Remind B")]
        const loneDesign = await createDesign("Remind Lone")

        const bundle = await produceDesignsAsWorkOrder(container, bundleDesigns, partnerId, {
          selections: bundleDesigns.map((id) => ({ design_id: id, template_ids: [template] })),
        })
        const lone = await produceDesignsAsWorkOrder(container, [loneDesign], partnerId, {
          selections: [{ design_id: loneDesign, template_ids: [template] }],
        })
        expect(bundle.dispatched).toHaveLength(2)
        expect(lone.dispatched).toHaveLength(1)

        const eventBus: any = container.resolve(Modules.EVENT_BUS)
        const seen: { name: string; data: any }[] = []
        const originalEmit = eventBus.emit.bind(eventBus)
        const spy = jest.spyOn(eventBus, "emit").mockImplementation(async (...args: any[]) => {
          const list = Array.isArray(args[0]) ? args[0] : [args[0]]
          for (const e of list) {
            if (e?.name) seen.push({ name: e.name, data: e.data })
          }
          return originalEmit(...args)
        })
        const remindRun = (runId: string) =>
          emitProductionRunReminderWorkflow(container).run({
            input: { production_run_id: runId, partner_id: partnerId, reminder_kind: "assignment_pending" },
          })
        try {
          await remindRun(bundle.run_ids[0])
          await remindRun(lone.run_ids[0])
        } finally {
          spy.mockRestore()
        }

        const bundled = seen.filter((e) => e.name === "production_run.reminder_in_bundle")
        expect(bundled).toHaveLength(1)
        expect(bundled[0].data).toMatchObject({
          production_run_id: bundle.run_ids[0],
          reminder_kind: "assignment_pending",
          work_order_id: bundle.work_order_id,
        })
        const own = seen.filter(
          (e) => e.name === "production_run.reminder_assignment_pending" && e.data?.bundle_fallback !== true
        )
        expect(own.map((e) => e.data.production_run_id)).toEqual([lone.run_ids[0]])

        // The bundle reads back from the database: both designs, one work order.
        const found = await findRunBundle(container, bundle.run_ids[1], partnerId)
        expect(found?.work_order_id).toBe(bundle.work_order_id)
        expect(found?.runs.map((r) => r.id).sort()).toEqual([...bundle.run_ids].sort())
        expect(await findRunBundle(container, lone.run_ids[0], partnerId)).toBeNull()
      })

      it("splits each design's pieces across its own sizes, and refuses a garment with none (#2500)", async () => {
        const container = getContainer()
        const template = await createTemplate("sizes", "Production")
        const sized = await api.post(
          "/admin/designs",
          {
            name: `Produce Sized ${Date.now()}`,
            description: "two sizes",
            design_type: "Original",
            status: "Approved",
            priority: "Medium",
            product_type: "jacket",
            size_sets: [
              { size_label: "38", measurements: { chest: 38 } },
              { size_label: "40", measurements: { chest: 40 } },
            ],
          },
          adminHeaders
        )
        const unsized = await api.post(
          "/admin/designs",
          {
            name: `Produce Unsized ${Date.now()}`,
            description: "no sizes",
            design_type: "Original",
            status: "Approved",
            priority: "Medium",
            product_type: "jacket",
          },
          adminHeaders
        )
        const sizedId = sized.data.design.id as string
        const unsizedId = unsized.data.design.id as string

        const result = await produceDesignsAsWorkOrder(container, [sizedId, unsizedId], partnerId, {
          selections: [
            { design_id: sizedId, template_ids: [template], quantity: 3 },
            { design_id: unsizedId, template_ids: [template], quantity: 3 },
          ],
        })

        // The sized design goes, its 3 pieces split 38×2, 40×1 and stored on the run.
        expect(result.dispatched).toEqual([sizedId])
        const runService: any = container.resolve(PRODUCTION_RUNS_MODULE)
        const [run] = await runService.listProductionRuns(
          { id: result.run_ids },
          { select: ["id", "design_id", "quantity", "planned_output"] }
        )
        expect(run.design_id).toBe(sizedId)
        expect(run.quantity).toBe(3)
        expect(run.planned_output).toEqual([
          { size_label: "38", color: null, quantity: 2 },
          { size_label: "40", color: null, quantity: 1 },
        ])

        // The garment with no sizes is refused, naming the sizes it needs, and
        // no run is created for it.
        expect(result.not_dispatched).toHaveLength(1)
        expect(result.not_dispatched[0]).toMatchObject({
          design_id: unsizedId,
          run_id: null,
          dispatched: false,
          missing_sizes: ["M", "L", "XL"],
        })
        expect(result.not_dispatched[0].reason).toMatch(/states no sizes/)
        expect(result.run_ids).toHaveLength(1)
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

    /**
     * #1574 — an admin cancels a run and the order goes on rendering as live
     * work.
     *
     * `deriveRunPartnerStatus` returned `undefined` for an admin cancel and the
     * mirror writes only truthy values, so `partner_status` was never cleared:
     * it kept `assigned` / `accepted` / `in_progress` forever. The core
     * `order.status` was always right — it is the sidecar the panels read that
     * lied, which is why a cancelled order looked half-finished.
     *
     * ⚠️ ONE test, walking the whole sequence, deliberately. The runner restores
     * a DB snapshot before every test, so a fixture built in a nested
     * `beforeAll` is gone by the time the body runs — and each step here needs
     * the previous step's cancel to have happened.
     */
    it("stops calling an order live once its runs are cancelled (#1574)", async () => {
      const container = getContainer()
      const unique = Date.now()
      const ids: string[] = []
      for (let i = 0; i < 2; i++) {
        const res = await api.post(
          "/admin/designs",
          {
            name: `Cancel Fixture Design ${unique}-${i}`,
            description: "#1574 cancel fixture",
            design_type: "Original",
            status: "Approved",
            priority: "Medium",
            estimated_cost: 500,
            size_sets: ONE_SIZE,
          },
          adminHeaders
        )
        ids.push(res.data.design.id)
      }

      const produced = await produceDesignsAsWorkOrder(container, ids, partnerId)
      const workOrderId = produced.work_order_id!
      const runIds = produced.run_ids
      expect(runIds).toHaveLength(2)

      const readWorkOrder = async (qs = "") => {
        const res = await api.get(
          `/admin/design-work-orders?limit=100${qs}`,
          adminHeaders
        )
        expect(res.status).toBe(200)
        return res.data.design_work_orders.find((w: any) => w.id === workOrderId)
      }

      const readStatuses = async () => {
        const q = container.resolve(ContainerRegistrationKeys.QUERY) as any
        const { data } = await q.graph({
          entity: "orders",
          fields: ["id", "status", "unified_order_status.partner_status"],
          filters: { id: workOrderId },
        })
        return {
          core: data?.[0]?.status,
          partner: data?.[0]?.unified_order_status?.partner_status ?? null,
        }
      }

      expect((await readWorkOrder()).design_count).toBe(2)

      // ── Cancel ONE of the two ───────────────────────────────────────────
      expect(
        (
          await api.post(
            `/admin/production-runs/${runIds[0]}/cancel`,
            { reason: "test cancel" },
            adminHeaders
          )
        ).status
      ).toBe(200)

      // 🔴 Fails on the old code: the cancelled run kept rendering as a design
      // line and `design_count` kept counting it, so an order half called off
      // still read as work in flight.
      const afterOne = await readWorkOrder()
      expect(afterOne.design_count).toBe(1)
      expect(afterOne.runs.map((r: any) => r.id)).not.toContain(runIds[0])

      // Hidden, not dropped — "what happened to this order" stays answerable.
      const withCancelled = await readWorkOrder("&include_cancelled=true")
      expect(withCancelled.design_count).toBe(2)
      expect(withCancelled.runs.map((r: any) => r.id)).toContain(runIds[0])

      // ⚠️ The counter-case that makes the fix safe to deploy: one cancelled run
      // among live ones must NOT retire the order. If "cancelled" joined the
      // progress ordering it would sort below everything and do exactly that.
      expect((await readStatuses()).partner).toBe("assigned")

      // ── Cancel the other ────────────────────────────────────────────────
      expect(
        (
          await api.post(
            `/admin/production-runs/${runIds[1]}/cancel`,
            { reason: "test cancel" },
            adminHeaders
          )
        ).status
      ).toBe(200)

      const { core, partner } = await readStatuses()
      // The core status was never the bug — it mapped cancelled correctly all
      // along. Asserted anyway so a regression names which of the two moved.
      expect(core).toBe("canceled")
      // 🔴 The assertion that fails on the old code: still "assigned", because
      // an admin cancel derived `undefined` and the mirror skipped the write.
      expect(partner).toBe("cancelled")

      // And the fully-cancelled order leaves the list rather than rendering as
      // a work-order with no designs left in it.
      expect(await readWorkOrder()).toBeUndefined()
      expect(await readWorkOrder("&include_cancelled=true")).toBeDefined()
    })
  })
})
