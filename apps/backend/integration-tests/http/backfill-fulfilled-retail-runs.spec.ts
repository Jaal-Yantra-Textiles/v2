import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { IOrderModuleService, IRegionModuleService } from "@medusajs/types"

import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { seedCommonEmailTemplates } from "../helpers/seed-email-templates"
import { setupCheckoutInfrastructure } from "../helpers/setup-checkout-infrastructure"
import { ensureOrderFulfillment } from "../../src/workflows/orders/fulfillment-context"
import orderPlacedHandler from "../../src/subscribers/order-placed"
import { PRODUCTION_RUNS_MODULE } from "../../src/modules/production_runs"

jest.setTimeout(90 * 1000)

// #1122 — the ops backfill job re-mints the #1112 fulfillment provenance runs
// for orders that were fulfilled BEFORE the live path existed (empty product
// design trail). Reuses the live subscriber's shared planner, so it never
// double-creates and completes stuck design-backed runs (#1126).
setupSharedTestSuite(() => {
  describe("backfill-fulfilled-retail-production-runs maintenance job", () => {
    let adminHeaders: { headers: Record<string, string> }
    let regionId: string
    const RUN =
      "/admin/ops/maintenance-jobs/backfill-fulfilled-retail-production-runs/run"

    beforeAll(async () => {
      const { api, getContainer } = getSharedTestEnv()
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)
      await seedCommonEmailTemplates(api, adminHeaders)

      const regionsRes = await api.get("/admin/regions", adminHeaders)
      if (regionsRes.data.regions?.length > 0) {
        regionId = regionsRes.data.regions[0].id
      } else {
        const regionService = container.resolve(
          Modules.REGION
        ) as IRegionModuleService
        const region = await regionService.createRegions({
          name: "Backfill Runs Region",
          currency_code: "usd",
          countries: ["us"],
        })
        regionId = region.id
      }
      await setupCheckoutInfrastructure(container, regionId)
    })

    const createProduct = async (
      api: any,
      unique: string | number,
      suffix: string,
      designId?: string
    ) => {
      const res = await api.post(
        "/admin/products",
        {
          title: `Backfill Product ${suffix} ${unique}`,
          status: "published",
          handle: `backfill-prod-${suffix}-${unique}`,
          options: [{ title: "Default", values: ["Default"] }],
        },
        adminHeaders
      )
      expect(res.status).toBe(200)
      const productId = res.data.product.id
      if (designId) {
        const linkRes = await api.post(
          `/admin/products/${productId}/linkDesign`,
          { designId },
          adminHeaders
        )
        expect(linkRes.status).toBe(200)
      }
      return productId
    }

    const createOrder = async (
      container: any,
      unique: number,
      productIds: string[]
    ) => {
      const orderService = container.resolve(
        Modules.ORDER
      ) as IOrderModuleService
      const createdOrder: any = await orderService.createOrders({
        region_id: regionId,
        currency_code: "usd",
        email: `backfill-${unique}@jyt.test`,
        items: productIds.map((pid, i) => ({
          title: `Line ${i}`,
          quantity: i + 1,
          unit_price: 1000,
          product_id: pid,
        })),
      } as any)
      return createdOrder.id as string
    }

    const runsForOrder = async (query: any, orderId: string, fields: string[]) => {
      const { data } = await query.graph({
        entity: "production_runs",
        fields,
        filters: { order_id: orderId },
      })
      return (data || []) as any[]
    }

    const waitForRuns = async (query: any, orderId: string, expected: number) => {
      let runs: any[] = []
      for (let i = 0; i < 40; i++) {
        runs = await runsForOrder(query, orderId, ["id", "status"])
        if (runs.length >= expected) break
        await new Promise((r) => setTimeout(r, 150))
      }
      return runs
    }

    it("re-mints missing provenance runs for a historically-fulfilled order and is idempotent", async () => {
      const { api, getContainer } = getSharedTestEnv()
      const container = getContainer()
      const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
      const runService: any = container.resolve(PRODUCTION_RUNS_MODULE)
      const unique = Date.now()

      // A design-backed line + a design-less line.
      const designRes = await api.post(
        "/admin/designs",
        {
          name: `Backfill Design ${unique}`,
          description: "backfill test",
          design_type: "Original",
          status: "Commerce_Ready",
          priority: "Medium",
        },
        adminHeaders
      )
      expect(designRes.status).toBe(201)
      const designId = designRes.data.design.id

      const linkedProductId = await createProduct(api, unique, "linked", designId)
      const bareProductId = await createProduct(api, unique, "bare")

      const orderId = await createOrder(container, unique, [
        linkedProductId,
        bareProductId,
      ])

      // Real lifecycle: payment then fulfillment (the live path mints/completes
      // runs). We then DELETE them to reconstruct the pre-#1112 historical state
      // (fulfilled order, empty design trail).
      await orderPlacedHandler({
        event: { data: { id: orderId } },
        container,
      } as any)
      await ensureOrderFulfillment(container, orderId)
      const liveRuns = await waitForRuns(query, orderId, 2)
      expect(liveRuns.length).toBe(2)
      await runService.deleteProductionRuns(liveRuns.map((r) => r.id))
      expect((await runsForOrder(query, orderId, ["id"])).length).toBe(0)

      // ── Dry-run: previews 2 creates, writes nothing ──────────────────────
      const dry = await api.post(
        RUN,
        { dry_run: true, params: { order_ids: orderId } },
        adminHeaders
      )
      expect(dry.status).toBe(200)
      expect(dry.data.result.dry_run).toBe(true)
      expect(dry.data.result.applied).toBe(false)
      expect(dry.data.result.changes.length).toBe(2)
      expect((await runsForOrder(query, orderId, ["id"])).length).toBe(0)

      // ── Apply: mints 2 completed runs (product-only + design-backed) ─────
      const applied = await api.post(
        RUN,
        { dry_run: false, params: { order_ids: orderId } },
        adminHeaders
      )
      expect(applied.status).toBe(200)
      expect(applied.data.result.applied).toBe(true)

      const runs = await runsForOrder(query, orderId, [
        "id",
        "status",
        "design_id",
        "product_id",
        "produced_quantity",
      ])
      expect(runs.length).toBe(2)
      for (const r of runs) {
        expect(r.status).toBe("completed")
      }
      const linkedRun = runs.find((r) => r.product_id === linkedProductId)
      const bareRun = runs.find((r) => r.product_id === bareProductId)
      expect(linkedRun.design_id).toBe(designId)
      expect(bareRun.design_id).toBeNull()
      // Quantities mirror the fulfilled line qty (Line 0 = 1, Line 1 = 2).
      expect(linkedRun.produced_quantity).toBe(1)
      expect(bareRun.produced_quantity).toBe(2)

      // ── Re-apply: idempotent no-op (runs exist + completed → skip) ────────
      const reapply = await api.post(
        RUN,
        { dry_run: false, params: { order_ids: orderId } },
        adminHeaders
      )
      expect(reapply.status).toBe(200)
      expect(reapply.data.result.applied).toBe(false)
      expect(reapply.data.result.changes.length).toBe(0)
      expect((await runsForOrder(query, orderId, ["id"])).length).toBe(2)
    })

    it("completes a design-backed run left stuck in pending_review", async () => {
      const { api, getContainer } = getSharedTestEnv()
      const container = getContainer()
      const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
      const runService: any = container.resolve(PRODUCTION_RUNS_MODULE)
      const unique = Date.now() + 1

      const designRes = await api.post(
        "/admin/designs",
        {
          name: `Backfill Stuck Design ${unique}`,
          description: "stuck run test",
          design_type: "Original",
          status: "Commerce_Ready",
          priority: "Medium",
        },
        adminHeaders
      )
      expect(designRes.status).toBe(201)
      const designId = designRes.data.design.id
      const linkedProductId = await createProduct(api, unique, "stuck", designId)

      const orderId = await createOrder(container, unique, [linkedProductId])

      // order.placed mints the design-backed run (pending_review).
      await orderPlacedHandler({
        event: { data: { id: orderId } },
        container,
      } as any)
      await ensureOrderFulfillment(container, orderId)

      // Wait for the live fulfillment subscriber to SETTLE (it completes the
      // run async) before forcing it back — otherwise its completion races past
      // our manual downgrade. Then force pending_review to reconstruct the
      // pre-#1126 "stuck" historical state (order fulfilled, run never completed).
      let runId = ""
      for (let i = 0; i < 40; i++) {
        const rs = await runsForOrder(query, orderId, ["id", "status"])
        if (rs.length === 1 && rs[0].status === "completed") {
          runId = rs[0].id
          break
        }
        await new Promise((r) => setTimeout(r, 150))
      }
      expect(runId).not.toBe("")
      await runService.updateProductionRuns({
        id: runId,
        status: "pending_review",
        produced_quantity: null,
      })

      const applied = await api.post(
        RUN,
        { dry_run: false, params: { order_ids: orderId } },
        adminHeaders
      )
      expect(applied.status).toBe(200)
      expect(applied.data.result.applied).toBe(true)

      const after = await runsForOrder(query, orderId, [
        "id",
        "status",
        "produced_quantity",
      ])
      // Same run (no double-create), now completed with the shipped qty.
      expect(after.length).toBe(1)
      expect(after[0].id).toBe(runId)
      expect(after[0].status).toBe("completed")
      expect(after[0].produced_quantity).toBe(1)
    })
  })
})
