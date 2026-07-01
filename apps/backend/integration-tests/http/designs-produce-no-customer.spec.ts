import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { IRegionModuleService } from "@medusajs/types"

import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { produceDesignsAsWorkOrder } from "../../src/workflows/designs/produce-designs-as-work-order"
import { PRODUCTION_RUNS_MODULE } from "../../src/modules/production_runs"
import { PARTNER_MODULE } from "../../src/modules/partner"
import partnerOrderLink from "../../src/links/partner-order"

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
    })
  })
})
