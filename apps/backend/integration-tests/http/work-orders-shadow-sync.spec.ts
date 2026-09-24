/**
 * #2263 S1 — the new `work_order` table follows the #342 mirror.
 *
 *   1. SHADOW WRITE: real admin flows (design runs, inventory create /
 *      send-to-partner / status change / line edit) leave a work_order that
 *      reads exactly like its mirror — `work-order-parity` reports 0 mismatches.
 *   2. BYPASS: a mirror change that skips the writers (a direct core-order
 *      status write) shows up as a parity mismatch, and `backfill-work-orders`
 *      repairs it.
 *   3. BACKFILL FROM EMPTY: with the work_order gone, the backfill previews a
 *      create, applies it with the mirror's id / display_id / created_at, and
 *      moves the display_id sequence past the carried numbers.
 */
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  backfillWorkOrdersJob,
  workOrderParityJob,
} from "../../src/api/admin/ops/maintenance-jobs/work-order-jobs"
import { WORK_ORDER_MODULE } from "../../src/modules/work_orders"
import { PRODUCTION_RUNS_MODULE } from "../../src/modules/production_runs"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { ensureHouseStoreRegion } from "../helpers/ensure-house-store-region"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(120000)

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("work_order shadow sync + backfill (#2263 S1)", () => {
    let adminHeaders: any
    let partnerId: string
    let unique: number

    const post = async (url: string, body: any) => {
      try {
        return await api.post(url, body, adminHeaders)
      } catch (err: any) {
        throw new Error(`POST ${url} failed: ${err?.response?.status} ${JSON.stringify(err?.response?.data)}`)
      }
    }
    const put = async (url: string, body: any) => {
      try {
        return await api.put(url, body, adminHeaders)
      } catch (err: any) {
        throw new Error(`PUT ${url} failed: ${err?.response?.status} ${JSON.stringify(err?.response?.data)}`)
      }
    }

    const mirrorIdOf = async (entity: "production_runs" | "inventory_orders", id: string) => {
      const query: any = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({ entity, filters: { id }, fields: ["order.id"] })
      const orderId = data?.[0]?.order?.id
      expect(orderId).toBeTruthy()
      return orderId as string
    }

    const parity = async (orderId: string) =>
      workOrderParityJob.run(getContainer(), { dry_run: true, params: { order_ids: orderId } })

    const expectInParity = async (orderId: string) => {
      const r = await parity(orderId)
      // A readable failure: the mismatching fields, mirror vs work_order.
      expect({ summary: r.summary, changes: r.changes }).toEqual({
        summary: "1 mirror(s): 1 match, 0 mismatch, 0 missing a work_order",
        changes: [],
      })
    }

    const createDesignWorkOrder = async () => {
      const design = await post("/admin/designs", {
        name: `Shadow Design ${unique}`,
        description: "#2263",
        design_type: "Original",
        status: "Approved",
        priority: "Medium",
      })
      const tpl = `shadow-${unique}`
      await post("/admin/task-templates", {
        name: tpl, description: "t", priority: "medium", estimated_duration: 60, required_fields: {},
        eventable: false, notifiable: false, message_template: "",
        metadata: { workflow_type: "production_run" }, category: "Shadow",
      })
      const runs = await post(`/admin/designs/${design.data.design.id}/production-runs`, {
        assignments: [{ partner_id: partnerId, quantity: 3, role: "manufacturing", template_names: [tpl] }],
      })
      const runId = runs.data.children?.[0]?.id ?? runs.data.result?.children?.[0]?.id
      expect(runId).toBeTruthy()
      return { runId, orderId: await mirrorIdOf("production_runs", runId) }
    }

    const createInventoryWorkOrder = async () => {
      const item = await post("/admin/inventory-items", { title: "Raw Silk", sku: `RAW-SILK-${unique}` })
      const to = await post("/admin/stock-locations", { name: `To ${unique}` })
      const from = await post("/admin/stock-locations", { name: `From ${unique}` })
      for (const name of ["partner-order-sent", "partner-order-received", "partner-order-shipped"]) {
        await post("/admin/task-templates", {
          name, description: `${name} template`, priority: "medium", estimated_duration: 30,
          eventable: true, notifiable: true, metadata: { workflow_type: "partner_assignment" },
        })
      }
      const inv = await post("/admin/inventory-orders", {
        order_lines: [{ inventory_item_id: item.data.inventory_item.id, quantity: 12.9, price: 1155 }],
        quantity: 12.9,
        total_price: 14899.5,
        status: "Pending",
        expected_delivery_date: new Date().toISOString(),
        order_date: new Date().toISOString(),
        shipping_address: { first_name: "JYT", address_1: "Mill Road 1", city: "Jaipur", country_code: "in", postal_code: "302001" },
        stock_location_id: to.data.stock_location.id,
        from_stock_location_id: from.data.stock_location.id,
      })
      const invId = inv.data.inventoryOrder.id
      await post(`/admin/inventory-orders/${invId}/send-to-partner`, { partnerId, notes: "#2263" })
      return { invId, itemId: item.data.inventory_item.id, orderId: await mirrorIdOf("inventory_orders", invId) }
    }

    beforeEach(async () => {
      const container = getContainer()
      unique = Date.now()
      await createAdminUser(container)
      await ensureHouseStoreRegion(container)
      adminHeaders = await getAuthHeaders(api)
      const partner = await post("/admin/partners", {
        partner: { name: `Shadow ${unique}`, handle: `shadow-${unique}` },
        admin: { email: `shadow-${unique}@jyt.test`, first_name: "S", last_name: "S" },
      })
      partnerId = partner.data.partner.id
    })

    it("a design work order is shadowed on create, linked to its run, and in parity", async () => {
      const { runId, orderId } = await createDesignWorkOrder()
      const query: any = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "work_order",
        fields: ["id", "kind", "partner_id", "production_runs.id", "items.production_run_id"],
        filters: { id: orderId },
      })
      expect(data[0]).toMatchObject({ id: orderId, kind: "design" })
      expect(data[0].production_runs.map((r: any) => r.id)).toEqual([runId])
      expect(data[0].items.map((i: any) => i.production_run_id)).toEqual([runId])
      await expectInParity(orderId)
    })

    it("an inventory work order follows send-to-partner, a status change and a line edit", async () => {
      const { invId, itemId, orderId } = await createInventoryWorkOrder()
      const service: any = getContainer().resolve(WORK_ORDER_MODULE)

      // send-to-partner → partner link + assigned
      let wo = await service.retrieveWorkOrder(orderId)
      expect(wo.partner_id).toBe(partnerId)
      expect(wo.partner_status).toBe("assigned")
      await expectInParity(orderId)

      // status change → in_progress
      await put(`/admin/inventory-orders/${invId}`, { status: "Processing" })
      wo = await service.retrieveWorkOrder(orderId)
      expect(wo.partner_status).toBe("in_progress")
      await expectInParity(orderId)

      // line edit → the line is re-projected; the work_order's lines follow
      const query: any = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data: inv } = await query.graph({ entity: "inventory_orders", filters: { id: invId }, fields: ["orderlines.id"] })
      const lineId = inv[0].orderlines[0].id
      await put(`/admin/inventory-orders/${invId}/order-lines`, {
        order_lines: [{ id: lineId, inventory_item_id: itemId, quantity: 13, price: 1155 }],
      })
      wo = await service.retrieveWorkOrder(orderId, { relations: ["items"] })
      expect(wo.items.map((i: any) => Number(i.quantity))).toEqual([13])
      await expectInParity(orderId)
    })

    it("a mirror change that bypasses the writers is reported, and the backfill repairs it", async () => {
      const { orderId } = await createDesignWorkOrder()
      await getContainer().resolve(Modules.ORDER).updateOrders([{ id: orderId, status: "canceled" }])

      const drift = await parity(orderId)
      expect(drift.summary).toBe("1 mirror(s): 0 match, 1 mismatch, 0 missing a work_order")
      expect(drift.changes[0].field).toBe("status")

      await backfillWorkOrdersJob.run(getContainer(), { dry_run: false, params: { order_ids: orderId } })
      await expectInParity(orderId)
    })

    it("backfills from empty: preview writes nothing, apply carries id / display_id / created_at, sequence moves on", async () => {
      const container = getContainer()
      const { runId, orderId } = await createDesignWorkOrder()
      const service: any = container.resolve(WORK_ORDER_MODULE)
      const link: any = container.resolve(ContainerRegistrationKeys.LINK)

      // Remove what the shadow wrote, so the backfill starts from nothing.
      await link.dismiss([{ [WORK_ORDER_MODULE]: { work_order_id: orderId }, [PRODUCTION_RUNS_MODULE]: { production_runs_id: runId } }])
      await service.deleteWorkOrders([orderId])
      expect((await parity(orderId)).summary).toBe("1 mirror(s): 0 match, 0 mismatch, 1 missing a work_order")

      const preview = await backfillWorkOrdersJob.run(container, { dry_run: true, params: { order_ids: orderId } })
      expect(preview.changes).toEqual([expect.objectContaining({ id: orderId, after: "create" })])
      expect(await service.listWorkOrders({ id: orderId })).toEqual([])

      const applied = await backfillWorkOrdersJob.run(container, { dry_run: false, params: { order_ids: orderId } })
      expect(applied.summary).toBe("Created 1, resynced 0, skipped 0, failed 0 of 1 mirror(s)")

      const mirror = await container.resolve(Modules.ORDER).retrieveOrder(orderId, { select: ["id", "display_id", "created_at"] })
      const wo = await service.retrieveWorkOrder(orderId)
      expect(wo.display_id).toBe(mirror.display_id)
      expect(new Date(wo.created_at).toISOString()).toBe(new Date(mirror.created_at).toISOString())
      await expectInParity(orderId)

      // The sequence is past every carried number: a natively minted row gets a fresh one.
      const pg: any = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
      const { rows } = await pg.raw(`select nextval(pg_get_serial_sequence('work_order', 'display_id')) as n, (select max(display_id) from work_order) as max`)
      expect(Number(rows[0].n)).toBeGreaterThan(Number(rows[0].max))
    })
  })
})
