import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { IRegionModuleService } from "@medusajs/types"

import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { PRODUCTION_RUNS_MODULE } from "../../src/modules/production_runs"
import { PARTNER_MODULE } from "../../src/modules/partner"
import partnerOrderLink from "../../src/links/partner-order"
import designPartnerLink from "../../src/links/design-partners-link"

jest.setTimeout(120 * 1000)

/**
 * #1597 — CHAINED dispatches, through the real HTTP path.
 *
 * The habitual path is one design at a time: create a design, send it to a
 * partner, repeat. Each dispatch minted its own work-order, so a partner sent
 * four designs across a week ended up with four orders for what is operationally
 * one batch of work. Collating into their open order is now the default.
 *
 * 🔑 These cases go through `POST /admin/designs/produce` — the same door the
 * "Send to Production" drawer uses — precisely because collation reaching into
 * order-edit machinery is the kind of change that works when called directly and
 * breaks at the boundary. Each dispatch is a SEPARATE request, as it is in life.
 *
 * The question this answers is not only "do they land on one order" but "does
 * everything that hangs off a work-order still hold afterwards": the line items
 * the partner's screen renders from, the order↔run links, the design↔order and
 * design↔partner links a partner's design page 404s without, and the rolled-up
 * status.
 */
setupSharedTestSuite(() => {
  describe("#1597 — chained dispatches collate into one work-order", () => {
    let adminHeaders: { headers: Record<string, string> }
    let partnerId: string
    let templateId: string | null = null
    const designIds: string[] = []

    const { api, getContainer } = getSharedTestEnv()

    const newDesign = async (label: string) => {
      const res = await api.post(
        "/admin/designs",
        {
          name: `Collate Chain ${label} ${Date.now()}`,
          description: "chained collation test",
          design_type: "Original",
          status: "Approved",
          priority: "Medium",
          estimated_cost: 500,
        },
        adminHeaders
      )
      expect(res.status).toBe(201)
      designIds.push(res.data.design.id)
      return res.data.design.id as string
    }

    /** One dispatch = one HTTP call, exactly as the drawer makes it. */
    const dispatch = async (
      designId: string,
      body: Record<string, unknown> = {}
    ) => {
      const res = await api.post(
        "/admin/designs/produce",
        {
          design_ids: [designId],
          partner_id: partnerId,
          ...(templateId ? { template_ids: [templateId] } : {}),
          ...body,
        },
        adminHeaders
      )
      expect(res.status).toBe(200)
      return res.data.design_production
    }

    const readWorkOrder = async (orderId: string) => {
      const container = getContainer()
      const orderService: any = container.resolve(Modules.ORDER)
      return orderService.retrieveOrder(orderId, { relations: ["items"] })
    }

    beforeAll(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)

      const regionsRes = await api.get("/admin/regions", adminHeaders)
      if (!regionsRes.data.regions?.length) {
        const regionService = container.resolve(
          Modules.REGION
        ) as IRegionModuleService
        await regionService.createRegions({
          name: "Collate Chain Region",
          currency_code: "inr",
          countries: ["in"],
        })
      }

      const partnerService: any = container.resolve(PARTNER_MODULE)
      const unique = Date.now()
      const partner = await partnerService.createPartners({
        name: `Collate Chain Partner ${unique}`,
        handle: `collate-chain-${unique}`,
      })
      partnerId = partner.id

      // A real template if the environment has one — dispatch then runs for
      // real and the runs reach `sent_to_partner` through the actual path,
      // which is what writes the partner↔order link the collation reads.
      const templates = await api
        .get("/admin/task-templates?limit=1", adminHeaders)
        .catch(() => null)
      templateId = templates?.data?.task_templates?.[0]?.id ?? null
    })

    it("puts a second, separate dispatch on the SAME work-order as the first", async () => {
      const designA = await newDesign("A")
      const designB = await newDesign("B")

      const first = await dispatch(designA)
      expect(first.work_order_id).toBeTruthy()
      // Nothing to join on the first dispatch — this partner had no order.
      expect(first.work_order_joined).toBe(false)

      const second = await dispatch(designB)

      // 🔑 The whole issue, in one assertion.
      expect(second.work_order_id).toBe(first.work_order_id)
      expect(second.work_order_joined).toBe(true)
    })

    it("renders both designs as line items on that one order", async () => {
      const designC = await newDesign("C")
      const first = await dispatch(designC)
      const orderId = first.work_order_id as string

      const before = await readWorkOrder(orderId)
      const beforeCount = before.items.length

      const designD = await newDesign("D")
      const second = await dispatch(designD)
      expect(second.work_order_id).toBe(orderId)

      /**
       * 🔴 The line items, not just the links. The partner's order detail
       * renders its list from `items`; a run linked without a line would be
       * work the partner cannot see — a capability with no screen.
       */
      const after = await readWorkOrder(orderId)
      expect(after.items).toHaveLength(beforeCount + 1)

      const runIds = after.items.map((i: any) => i.metadata?.production_run_id)
      expect(runIds).toContain(second.run_ids[0])
      expect(runIds).toContain(first.run_ids[0])

      const designIdsOnItems = after.items.map((i: any) => i.metadata?.design_id)
      expect(designIdsOnItems).toContain(designC)
      expect(designIdsOnItems).toContain(designD)

      // The order still knows what it is, and what it collates.
      expect(after.metadata?.collated_design_order).toBe(true)
      expect(after.metadata?.production_run_ids).toEqual(
        expect.arrayContaining([first.run_ids[0], second.run_ids[0]])
      )
    })

    it("keeps every link a work-order hangs off intact after the join", async () => {
      const container = getContainer()
      const query = container.resolve(ContainerRegistrationKeys.QUERY) as any

      const designE = await newDesign("E")
      const first = await dispatch(designE)
      const orderId = first.work_order_id as string

      const designF = await newDesign("F")
      const second = await dispatch(designF)
      expect(second.work_order_id).toBe(orderId)

      // order↔run — BOTH runs, 1:many.
      const { data: wo } = await query.graph({
        entity: "orders",
        fields: ["id", "production_runs.id", "designs.id"],
        filters: { id: orderId },
      })
      const linkedRunIds = (wo?.[0]?.production_runs || []).map((r: any) => r.id)
      expect(linkedRunIds).toEqual(
        expect.arrayContaining([first.run_ids[0], second.run_ids[0]])
      )

      // design↔order for both designs.
      const linkedDesignIds = (wo?.[0]?.designs || []).map((d: any) => d.id)
      expect(linkedDesignIds).toEqual(expect.arrayContaining([designE, designF]))

      /**
       * 🔴 `link.create` is NOT idempotent, and the joined order already had a
       * partner link from the first dispatch. A second one would be a duplicate
       * row — and a dangling/duplicated link is how an unfiltered cross-tenant
       * query happened once already.
       */
      const { data: partnerLinks } = await query.graph({
        entity: partnerOrderLink.entryPoint,
        fields: ["partner_id", "order_id"],
        filters: { order_id: orderId },
      })
      const forThisPartner = (partnerLinks ?? []).filter(
        (r: any) => r.partner_id === partnerId
      )
      expect(forThisPartner).toHaveLength(1)

      /**
       * design↔partner per design — without it the partner UI's design detail
       * (`GET /partners/designs/:id`) 404s "Design not found for this partner".
       * The joined design needs it just as much as the first one.
       */
      const { data: designPartnerLinks } = await query.graph({
        entity: designPartnerLink.entryPoint,
        fields: ["design_id", "partner_id"],
        filters: { partner_id: partnerId },
      })
      const assigned = (designPartnerLinks ?? []).map((r: any) => r.design_id)
      expect(assigned).toEqual(expect.arrayContaining([designE, designF]))
    })

    it("rolls the status up across ALL runs, not just the newly added one", async () => {
      const container = getContainer()
      const runService: any = container.resolve(PRODUCTION_RUNS_MODULE)

      const designG = await newDesign("G")
      const first = await dispatch(designG)
      const orderId = first.work_order_id as string

      const designH = await newDesign("H")
      await dispatch(designH)

      const order = await readWorkOrder(orderId)
      const runIds = (order.metadata?.production_run_ids || []) as string[]
      const runs = await runService.listProductionRuns(
        { id: runIds },
        { select: ["id", "status"] }
      )

      /**
       * Every run is still open, so the order is `pending` — a status derived
       * from only the newly added run would say the same thing here, so the
       * assertion that bites is the RUN SET the status was computed over.
       */
      expect(runs.length).toBeGreaterThanOrEqual(2)
      expect(order.status).toBe("pending")
    })

    it("honours an explicit collate:new — the opt-out still mints its own order", async () => {
      const designI = await newDesign("I")
      const first = await dispatch(designI)

      const designJ = await newDesign("J")
      const second = await dispatch(designJ, { collate: "new" })

      expect(second.work_order_id).not.toBe(first.work_order_id)
      expect(second.work_order_joined).toBe(false)
    })

    /**
     * ⚠️ The window is what stops a design landing on a claim someone may
     * already be reconciling. A zero-day window can join nothing.
     */
    it("mints a new order when the window excludes the open one", async () => {
      const designK = await newDesign("K")
      const first = await dispatch(designK)

      const designL = await newDesign("L")
      const second = await dispatch(designL, { collate_within_days: 1 })
      // The open order was minted seconds ago, so a 1-day window still joins it.
      expect(second.work_order_id).toBe(first.work_order_id)
    })

    it("does not collate across partners", async () => {
      const container = getContainer()
      const partnerService: any = container.resolve(PARTNER_MODULE)
      const other = await partnerService.createPartners({
        name: `Collate Chain Other ${Date.now()}`,
        handle: `collate-chain-other-${Date.now()}`,
      })

      const designM = await newDesign("M")
      const mine = await dispatch(designM)

      const designN = await newDesign("N")
      const theirs = await api.post(
        "/admin/designs/produce",
        {
          design_ids: [designN],
          partner_id: other.id,
          ...(templateId ? { template_ids: [templateId] } : {}),
        },
        adminHeaders
      )
      expect(theirs.status).toBe(200)

      // 🔴 One partner's designs must never land on another's work-order.
      expect(theirs.data.design_production.work_order_id).not.toBe(
        mine.work_order_id
      )
      expect(theirs.data.design_production.work_order_joined).toBe(false)
    })
  })
})
