/**
 * #2264 S2c — the back-pointers read `work_order`'s own links when
 * WORK_ORDER_READS is on:
 *   - `unified_order_id` on GET /partners/production-runs/:id
 *   - `unified_order_id` on GET /partners/inventory-orders/:id
 *   - `unified_order_status` on GET /admin/inventory-orders/:id
 *   - GET /admin/production-runs?work_order_id=
 *
 * The ids are the same in both sources (the shadow write keeps them), so "the
 * flag-on answer is right" proves nothing on its own. Each test CUTS the
 * mirror's link after the shadow write: with the flag off the pointer is gone,
 * with it on it is still there — it can only have come from work_order.
 */
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { ORDER_INVENTORY_MODULE } from "../../src/modules/inventory_orders"
import { PRODUCTION_RUNS_MODULE } from "../../src/modules/production_runs"
import { WORK_ORDER_MODULE } from "../../src/modules/work_orders"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { ensureHouseStoreRegion } from "../helpers/ensure-house-store-region"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(90000)

const PASSWORD = "supersecret"

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("work-order back-pointers behind WORK_ORDER_READS (#2264 S2c)", () => {
    let adminHeaders: any
    let partnerHeaders: any
    let partnerId: string
    let unique: number

    const post = async (url: string, body: any, cfg?: any) => {
      try {
        return await api.post(url, body, cfg)
      } catch (err: any) {
        throw new Error(`POST ${url} failed: ${err?.response?.status} ${JSON.stringify(err?.response?.data)}`)
      }
    }

    const mirrorIdOf = async (entity: "inventory_orders" | "production_runs", id: string) => {
      const query: any = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({ entity, filters: { id }, fields: ["id", "order.id"] })
      const orderId = data?.[0]?.order?.id
      expect(orderId).toBeTruthy()
      return orderId as string
    }

    const workOrderExists = async (id: string) => {
      const query: any = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({ entity: "work_order", filters: { id }, fields: ["id"] })
      expect(data?.[0]?.id).toBe(id)
    }

    beforeEach(async () => {
      const container = getContainer()
      unique = Date.now()
      await createAdminUser(container)
      await ensureHouseStoreRegion(container)
      adminHeaders = await getAuthHeaders(api)

      const email = `wo-bp-${unique}@jyt.test`
      await post("/auth/partner/emailpass/register", { email, password: PASSWORD })
      const l1 = await post("/auth/partner/emailpass", { email, password: PASSWORD })
      const p = await post(
        "/partners",
        { name: `WO BP ${unique}`, handle: `wo-bp-${unique}`, admin: { email, first_name: "W", last_name: "B" } },
        { headers: { Authorization: `Bearer ${l1.data.token}` } }
      )
      partnerId = p.data.partner.id
      const l2 = await post("/auth/partner/emailpass", { email, password: PASSWORD })
      partnerHeaders = { headers: { Authorization: `Bearer ${l2.data.token}` } }

      for (const name of ["partner-order-sent", "partner-order-received", "partner-order-shipped"]) {
        await post(
          "/admin/task-templates",
          {
            name,
            description: `${name} template`,
            priority: "medium",
            estimated_duration: 30,
            eventable: true,
            notifiable: true,
            metadata: { workflow_type: "partner_assignment" },
          },
          adminHeaders
        )
      }
    })

    afterEach(() => {
      delete process.env.WORK_ORDER_READS
    })

    it("a run's work order and the ?work_order_id= filter come from work_order", async () => {
      const design = await post(
        "/admin/designs",
        { name: `BP Design ${unique}`, design_type: "Original", status: "Approved", priority: "Medium" },
        adminHeaders
      )
      const templateName = `wo-bp-${unique}`
      await post(
        "/admin/task-templates",
        {
          name: templateName,
          description: "t",
          priority: "medium",
          estimated_duration: 60,
          required_fields: {},
          eventable: false,
          notifiable: false,
          message_template: "",
          metadata: { workflow_type: "production_run" },
          category: "WO BP",
        },
        adminHeaders
      )
      const created = await post(
        `/admin/designs/${design.data.design.id}/production-runs`,
        { assignments: [{ partner_id: partnerId, quantity: 2, template_names: [templateName] }] },
        adminHeaders
      )
      const runId = created.data.children?.[0]?.id ?? created.data.result?.children?.[0]?.id
      const orderId = await mirrorIdOf("production_runs", runId)
      await workOrderExists(orderId)

      // Cut the MIRROR's order↔run link; work_order's own link is untouched.
      const link: any = getContainer().resolve(ContainerRegistrationKeys.LINK)
      await link.dismiss([
        { [Modules.ORDER]: { order_id: orderId }, [PRODUCTION_RUNS_MODULE]: { production_runs_id: runId } },
      ])

      const partnerRun = () => api.get(`/partners/production-runs/${runId}`, partnerHeaders)
      const adminList = () => api.get(`/admin/production-runs?work_order_id=${orderId}`, adminHeaders)

      delete process.env.WORK_ORDER_READS
      expect((await partnerRun()).data.unified_order_id ?? null).toBeNull()
      expect((await adminList()).data.production_runs.map((r: any) => r.id)).toEqual([])

      process.env.WORK_ORDER_READS = "true"
      expect((await partnerRun()).data.unified_order_id).toBe(orderId)
      expect((await adminList()).data.production_runs.map((r: any) => r.id)).toEqual([runId])
    })

    it("an inventory order's work order and work status come from work_order", async () => {
      const inv = await post("/admin/inventory-items", { title: "Raw Linen", sku: `BP-LINEN-${unique}` }, adminHeaders)
      const to = (await post("/admin/stock-locations", { name: `To ${unique}` }, adminHeaders)).data.stock_location.id
      const from = (await post("/admin/stock-locations", { name: `From ${unique}` }, adminHeaders)).data.stock_location.id
      const res = await post(
        "/admin/inventory-orders",
        {
          order_lines: [{ inventory_item_id: inv.data.inventory_item.id, quantity: 3, price: 100 }],
          quantity: 3,
          total_price: 300,
          status: "Pending",
          expected_delivery_date: new Date().toISOString(),
          order_date: new Date().toISOString(),
          shipping_address: { first_name: "J", address_1: "R", city: "J", country_code: "in", postal_code: "302001" },
          stock_location_id: to,
          from_stock_location_id: from,
        },
        adminHeaders
      )
      const invId = res.data.inventoryOrder.id
      await post(`/admin/inventory-orders/${invId}/send-to-partner`, { partnerId, notes: "#2264 S2c" }, adminHeaders)
      const orderId = await mirrorIdOf("inventory_orders", invId)
      await workOrderExists(orderId)

      // A status only work_order holds, so the admin answer names its source.
      const woService: any = getContainer().resolve(WORK_ORDER_MODULE)
      await woService.updateWorkOrders({ id: orderId, partner_status: "partial" })

      const link: any = getContainer().resolve(ContainerRegistrationKeys.LINK)
      await link.dismiss([
        { [Modules.ORDER]: { order_id: orderId }, [ORDER_INVENTORY_MODULE]: { inventory_orders_id: invId } },
      ])

      const partnerInv = () => api.get(`/partners/inventory-orders/${invId}`, partnerHeaders)
      const adminInv = () => api.get(`/admin/inventory-orders/${invId}`, adminHeaders)

      delete process.env.WORK_ORDER_READS
      expect((await partnerInv()).data.inventoryOrder.unified_order_id ?? null).toBeNull()
      expect((await adminInv()).data.inventoryOrder.unified_order_status ?? null).toBeNull()

      process.env.WORK_ORDER_READS = "true"
      expect((await partnerInv()).data.inventoryOrder.unified_order_id).toBe(orderId)
      expect((await adminInv()).data.inventoryOrder.unified_order_status?.partner_status).toBe("partial")
    })
  })
})
