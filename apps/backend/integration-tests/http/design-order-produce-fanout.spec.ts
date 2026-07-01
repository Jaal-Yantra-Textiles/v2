import { Modules } from "@medusajs/framework/utils"
import type { IRegionModuleService } from "@medusajs/types"
import { createOrderWorkflow } from "@medusajs/medusa/core-flows"

import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { createRunsForDesignOrder } from "../../src/workflows/designs/create-runs-for-design-order"
import { PRODUCTION_RUNS_MODULE } from "../../src/modules/production_runs"

jest.setTimeout(90 * 1000)

/**
 * #826 S3 (step 1) — createRunsForDesignOrder fans out one production_run per
 * design line item on a commissioning order, stamping order_id (the collation
 * group key) + order_line_item_id + design_id, and is idempotent.
 */
setupSharedTestSuite(() => {
  describe("#826 — produce a design order (per-line run fan-out)", () => {
    let adminHeaders: { headers: Record<string, string> }
    let regionId: string
    let designIds: string[] = []
    let orderId: string
    let lineItemByDesign: Record<string, string> = {}

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
          name: "Produce Fanout Region",
          currency_code: "inr",
          countries: ["in"],
        })
        regionId = region.id
      }

      const unique = Date.now()
      for (let i = 0; i < 2; i++) {
        const res = await api.post(
          "/admin/designs",
          {
            name: `Produce Fanout Design ${unique}-${i}`,
            description: "produce fan-out test",
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

      // A commissioning-style order: TITLE-ONLY line items, each carrying
      // metadata.design_id (exactly what convert-design-order produces).
      const { result: order }: any = await createOrderWorkflow(container).run({
        input: {
          is_draft_order: true,
          status: "draft",
          no_notification: true,
          region_id: regionId,
          currency_code: "inr",
          items: designIds.map((design_id, i) => ({
            title: `Design ${i}`,
            quantity: i + 1,
            unit_price: 100 + i * 40,
            metadata: { design_id },
          })) as any,
          metadata: { source: "design-order-convert" },
        } as any,
      })
      orderId = order.id
      for (const li of order.items as any[]) {
        lineItemByDesign[li.metadata.design_id] = li.id
      }
    })

    it("creates one run per design line (stamped with order + line + design) and is idempotent", async () => {
      const container = getContainer()

      const result = await createRunsForDesignOrder(container, orderId)
      expect(result.created).toBe(designIds.length)
      expect(result.design_ids.sort()).toEqual([...designIds].sort())

      const runService: any = container.resolve(PRODUCTION_RUNS_MODULE)
      const runs = await runService.listProductionRuns(
        { order_id: [orderId] },
        { select: ["id", "design_id", "order_id", "order_line_item_id"] }
      )
      expect(runs).toHaveLength(designIds.length)

      for (const run of runs) {
        expect(run.order_id).toBe(orderId)
        expect(designIds).toContain(run.design_id)
        // The run points back at the exact commissioning line item for its design.
        expect(run.order_line_item_id).toBe(lineItemByDesign[run.design_id])
      }

      // Idempotent: producing the same order again creates no duplicate runs.
      const again = await createRunsForDesignOrder(container, orderId)
      expect(again.created).toBe(0)
      const runsAfter = await runService.listProductionRuns({ order_id: [orderId] })
      expect(runsAfter).toHaveLength(designIds.length)
    })
  })
})
