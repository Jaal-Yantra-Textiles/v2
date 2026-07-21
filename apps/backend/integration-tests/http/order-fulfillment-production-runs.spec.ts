import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { IOrderModuleService, IRegionModuleService } from "@medusajs/types"

import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { seedCommonEmailTemplates } from "../helpers/seed-email-templates"
import { setupCheckoutInfrastructure } from "../helpers/setup-checkout-infrastructure"
import { ensureOrderFulfillment } from "../../src/workflows/orders/fulfillment-context"
import orderPlacedHandler from "../../src/subscribers/order-placed"
import orderFulfilledHandler from "../../src/subscribers/order-fullfilled"

jest.setTimeout(60 * 1000)

// #1112 — fulfillment-triggered provenance runs. A product sold and fulfilled
// from produced stock retroactively mints a COMPLETED production run hung off
// the Product spine, EVEN WHEN the product has no backing design (product-only
// path). Shares idempotency with the payment (order.placed) path.
setupSharedTestSuite(() => {
  describe("order.fulfillment_created subscriber → production runs", () => {
    let adminHeaders: { headers: Record<string, string> }
    let regionId: string

    beforeAll(async () => {
      const { api, getContainer } = getSharedTestEnv()
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)
      await seedCommonEmailTemplates(api, adminHeaders)

      // Fulfillment needs a shipping option + stock location, absent on the
      // fresh shared DB. Reuse the same infra the checkout/shiprocket tests do.
      const regionsRes = await api.get("/admin/regions", adminHeaders)
      if (regionsRes.data.regions?.length > 0) {
        regionId = regionsRes.data.regions[0].id
      } else {
        const regionService = container.resolve(
          Modules.REGION
        ) as IRegionModuleService
        const region = await regionService.createRegions({
          name: "Fulfillment Runs Region",
          currency_code: "usd",
          countries: ["us"],
        })
        regionId = region.id
      }
      await setupCheckoutInfrastructure(container, regionId)
    })

    // Create a product; optionally link a design. Returns the product id.
    const createProduct = async (
      api: any,
      unique: string | number,
      suffix: string,
      designId?: string
    ) => {
      const res = await api.post(
        "/admin/products",
        {
          title: `Fulfill Product ${suffix} ${unique}`,
          status: "published",
          handle: `fulfill-prod-${suffix}-${unique}`,
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

    // Create an order (not yet fulfilled) with the given product line items.
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
        email: `fulfill-${unique}@jyt.test`,
        // Title-only line items carrying product_id (no variant → no inventory
        // reservation, so the manual fulfillment path just works — same shape
        // the order-placed subscriber test uses).
        items: productIds.map((pid, i) => ({
          title: `Line ${i}`,
          quantity: i + 1,
          unit_price: 1000,
          product_id: pid,
        })),
      } as any)
      return createdOrder.id as string
    }

    // Fulfill the whole order via the shared helper (resolves shipping option +
    // location). This emits `order.fulfillment_created`, firing the real
    // subscriber. Returns the fulfillment id.
    const fulfillOrder = async (container: any, orderId: string) => {
      const fulfillmentId = await ensureOrderFulfillment(container, orderId)
      if (!fulfillmentId) throw new Error("fulfillment not created")
      return fulfillmentId
    }

    const createAndFulfillOrder = async (
      container: any,
      unique: number,
      productIds: string[]
    ) => {
      const orderId = await createOrder(container, unique, productIds)
      const fulfillmentId = await fulfillOrder(container, orderId)
      return { orderId, fulfillmentId }
    }

    // The real `order.fulfillment_created` subscriber fires (async) when
    // ensureOrderFulfillment emits the event — poll until the runs settle.
    const waitForRuns = async (
      query: any,
      orderId: string,
      expected: number,
      fields: string[] = ["id"]
    ) => {
      let runs: any[] = []
      for (let i = 0; i < 40; i++) {
        const { data } = await query.graph({
          entity: "production_runs",
          fields,
          filters: { order_id: orderId },
        })
        runs = data || []
        if (runs.length >= expected) {
          break
        }
        await new Promise((r) => setTimeout(r, 150))
      }
      return runs
    }

    it("mints a COMPLETED product-only run (design_id null) linked to the product for a design-less product", async () => {
      const { api, getContainer } = getSharedTestEnv()
      const container = getContainer()
      const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
      const unique = Date.now()

      const productId = await createProduct(api, unique, "solo")
      const { orderId, fulfillmentId } = await createAndFulfillOrder(
        container,
        unique,
        [productId]
      )

      // The real subscriber (fired by the fulfillment event) mints the run.
      const runs = await waitForRuns(query, orderId, 1, [
        "id",
        "design_id",
        "order_id",
        "order_line_item_id",
        "product_id",
        "quantity",
        "produced_quantity",
        "status",
      ])
      expect(runs.length).toBe(1)
      const run = runs[0]
      expect(run.design_id).toBeNull()
      expect(run.product_id).toBe(productId)
      expect(run.order_id).toBe(orderId)
      expect(run.status).toBe("completed")
      expect(run.produced_quantity).toBe(1)

      // Provenance trail is queryable FROM the product spine via the new link.
      const { data: prods } = await query.graph({
        entity: "product",
        fields: ["id", "production_runs.id", "production_runs.status"],
        filters: { id: productId },
      })
      const linkedRuns = prods?.[0]?.production_runs || []
      expect(linkedRuns.map((r: any) => r.id)).toContain(run.id)

      // Idempotency: re-firing the handler directly must not double-create
      // (the run already exists → shared line-item guard skips it).
      await orderFulfilledHandler({
        event: {
          data: { order_id: orderId, fulfillment_id: fulfillmentId, no_notification: true },
        },
        container,
      } as any)
      const { data: runs2 } = await query.graph({
        entity: "production_runs",
        fields: ["id"],
        filters: { order_id: orderId },
      })
      expect((runs2 || []).length).toBe(1)
    })

    it("completes (not double-creates) the design-backed run order.placed minted, and mints the bare product's run", async () => {
      const { api, getContainer } = getSharedTestEnv()
      const container = getContainer()
      const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
      const unique = Date.now() + 1

      // A design-backed product (order.placed will mint its run at payment) and
      // a design-less product (only the fulfillment path can mint its run).
      const designRes = await api.post(
        "/admin/designs",
        {
          name: `Fulfill Design ${unique}`,
          description: "fulfillment idempotency test",
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

      // Real-world order: payment (order.placed) BEFORE fulfillment. Create the
      // order, then run the payment path — it mints a pending_review run for the
      // design-backed line only.
      const orderId = await createOrder(container, unique, [
        linkedProductId,
        bareProductId,
      ])
      await orderPlacedHandler({
        event: { data: { id: orderId } },
        container,
      } as any)

      const { data: afterPlaced } = await query.graph({
        entity: "production_runs",
        fields: ["id", "product_id", "status", "design_id"],
        filters: { order_id: orderId },
      })
      const placedRuns = afterPlaced || []
      expect(placedRuns.length).toBe(1)
      expect(placedRuns[0].product_id).toBe(linkedProductId)
      expect(placedRuns[0].status).toBe("pending_review")
      const linkedRunId = placedRuns[0].id

      // Now fulfill — the real fulfillment subscriber must SKIP the linked line
      // (already has a run) and mint only the bare product's completed run.
      await fulfillOrder(container, orderId)

      // Poll until the design-backed run has been completed by the fulfillment
      // subscriber (it starts pending_review, so a length check alone races).
      let runs: any[] = []
      for (let i = 0; i < 40; i++) {
        runs = await waitForRuns(query, orderId, 2, [
          "id",
          "product_id",
          "status",
          "design_id",
          "produced_quantity",
        ])
        const linked = runs.find((r: any) => r.product_id === linkedProductId)
        if (runs.length >= 2 && linked?.status === "completed") {
          break
        }
        await new Promise((r) => setTimeout(r, 150))
      }
      expect(runs.length).toBe(2)

      // #1126 — the same design-backed run (no double-create) is transitioned
      // to completed from stock, with the shipped quantity stamped.
      const linkedRun = runs.find((r: any) => r.product_id === linkedProductId)
      expect(linkedRun.id).toBe(linkedRunId)
      expect(linkedRun.status).toBe("completed")
      expect(linkedRun.produced_quantity).toBe(1)

      // The bare product got a completed product-only run.
      const bareRun = runs.find((r: any) => r.product_id === bareProductId)
      expect(bareRun.design_id).toBeNull()
      expect(bareRun.status).toBe("completed")

      // #1126 — neither retail run is projected onto the #342 unified view: the
      // order↔production_run link (`production_runs.order`) must be absent so
      // the retail order isn't mis-discriminated as a design work-order.
      const { data: projections } = await query.graph({
        entity: "production_runs",
        fields: ["id", "order.id"],
        filters: { id: [linkedRun.id, bareRun.id] },
      })
      for (const p of projections || []) {
        expect(p.order ?? null).toBeNull()
      }
    })
  })
})
