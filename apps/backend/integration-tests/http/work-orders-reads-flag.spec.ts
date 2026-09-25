/**
 * #2264 S2 — the partner reads, flipped to `work_order` behind WORK_ORDER_READS,
 * answer EXACTLY as they did from the mirror — and are proven to come from
 * work_order, not a silent fallback to core.
 *
 * The marker: the mirror carries the internal "Partner Work Orders" sales
 * channel; `toOrderShape` serves `sales_channel_id: null`. A flag-on response
 * that still has the channel was answered by core, and this spec fails.
 *
 * (Header below is the #2262 parity fixture, reused.)
 *
 * #2262 S0 — PARITY: a work order stored in the new `work_orders` module and
 * served through `toOrderShape()` must read to the UI exactly as the #342
 * core-order mirror reads today through the partner API.
 *
 * For a real design work order and a real inventory work order (built through
 * the same admin endpoints production uses, which write the mirror):
 *   1. read what partner-ui reads today — `GET /partners/orders/:id` and the
 *      `GET /partners/orders?kind=…` row;
 *   2. read the work_order the shadow write (#2263) saved for it — same ids —
 *      back through query.graph;
 *   3. serve it with `toOrderShape` and compare on the contract.
 * Step 2 goes through the database on purpose: bigNumber quantities and the
 * typed line columns must survive a round trip, and every link must resolve.
 */
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { toOrderShape } from "../../src/lib/work-orders/to-order-shape"
import {
  pickWorkOrderContract,
  pickWorkOrderListContract,
} from "../../src/lib/work-orders/work-order-contract"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { ensureHouseStoreRegion } from "../helpers/ensure-house-store-region"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
// The EXACT field set partner-ui's order-detail loader requests. Imported, not
// copied, so this spec compares what the partner actually receives.
import { DEFAULT_FIELDS as PARTNER_UI_DETAIL_FIELDS } from "../../../partner-ui/src/routes/orders/order-detail/constants"

jest.setTimeout(90000)

const PASSWORD = "supersecret"

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("partner work-order reads behind WORK_ORDER_READS (#2264 S2)", () => {
    let adminHeaders: any
    let partnerHeaders: any
    let partnerId: string
    let unique: number
    let inventoryItemId: string
    let stockLocationId: string
    let fromStockLocationId: string

    const post = async (url: string, body: any, cfg?: any) => {
      try {
        return await api.post(url, body, cfg)
      } catch (err: any) {
        throw new Error(
          `POST ${url} failed: ${err?.response?.status} ${JSON.stringify(err?.response?.data)}`
        )
      }
    }

    const mirrorIdOf = async (
      entity: "inventory_orders" | "production_runs",
      id: string
    ): Promise<string> => {
      const query: any = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({ entity, filters: { id }, fields: ["id", "order.id"] })
      const orderId = data?.[0]?.order?.id
      expect(orderId).toBeTruthy()
      return orderId
    }

    /**
     * Read the work_order the SHADOW WRITE saved when the mirror was written
     * (#2263 S1) — through query.graph, so the real run link and the read-only
     * links (partner, inventory order, line → run / design) are exercised —
     * and serve it. (Under S0 this spec converted + inserted by hand; the
     * shadow write now does exactly that on the production path.)
     */
    const persistAndServe = async (orderId: string) => {
      const query: any = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data: storedRows } = await query.graph({
        entity: "work_order",
        fields: [
          "*",
          "items.*",
          "production_runs.id",
          "partner.id",
          "inventory_orders.id",
          "items.production_run.id",
          "items.design.id",
        ],
        filters: { id: orderId },
      })
      const stored = storedRows[0]
      expect(stored).toBeTruthy()
      return { stored, served: toOrderShape(stored) }
    }

    const oldDetail = async (orderId: string) => {
      const res = await api.get(
        `/partners/orders/${orderId}?fields=${encodeURIComponent(PARTNER_UI_DETAIL_FIELDS)}`,
        partnerHeaders
      )
      expect(res.status).toBe(200)
      return res.data.order
    }

    const oldListRow = async (orderId: string, kind: "design" | "inventory") => {
      const res = await api.get(`/partners/orders?kind=${kind}&limit=50`, partnerHeaders)
      expect(res.status).toBe(200)
      const row = (res.data.orders || []).find((o: any) => o.id === orderId)
      expect(row).toBeTruthy()
      return row
    }

    beforeEach(async () => {
      const container = getContainer()
      unique = Date.now()
      await createAdminUser(container)
      await ensureHouseStoreRegion(container)
      adminHeaders = await getAuthHeaders(api)

      const email = `wo-parity-${unique}@jyt.test`
      await post("/auth/partner/emailpass/register", { email, password: PASSWORD })
      const login1 = await post("/auth/partner/emailpass", { email, password: PASSWORD })
      const partnerRes = await post(
        "/partners",
        {
          name: `WO Parity ${unique}`,
          handle: `wo-parity-${unique}`,
          admin: { email, first_name: "WO", last_name: "Parity" },
        },
        { headers: { Authorization: `Bearer ${login1.data.token}` } }
      )
      partnerId = partnerRes.data.partner.id
      const login2 = await post("/auth/partner/emailpass", { email, password: PASSWORD })
      partnerHeaders = { headers: { Authorization: `Bearer ${login2.data.token}` } }

      const inv = await post(
        "/admin/inventory-items",
        { title: "Raw Linen", sku: `RAW-LINEN-${unique}` },
        adminHeaders
      )
      inventoryItemId = inv.data.inventory_item.id
      stockLocationId = (await post("/admin/stock-locations", { name: `To ${unique}` }, adminHeaders))
        .data.stock_location.id
      fromStockLocationId = (
        await post("/admin/stock-locations", { name: `From ${unique}` }, adminHeaders)
      ).data.stock_location.id

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

    const listRow = async (orderId: string, kind: string) => {
      const res = await api.get(`/partners/orders?kind=${kind}&limit=50`, partnerHeaders)
      expect(res.status).toBe(200)
      return { row: (res.data.orders || []).find((o: any) => o.id === orderId), count: res.data.count }
    }

    /** Read every partner surface with the flag off, then on, and compare. */
    const compareFlag = async (orderId: string, kind: "design" | "inventory") => {
      delete process.env.WORK_ORDER_READS
      const offDetail = await oldDetail(orderId)
      const offKind = await listRow(orderId, kind)
      const offAll = await listRow(orderId, "all")
      const offRetail = await api.get(`/partners/orders?kind=retail&limit=50`, partnerHeaders)

      process.env.WORK_ORDER_READS = "true"
      const onDetail = await oldDetail(orderId)
      const onKind = await listRow(orderId, kind)
      const onAll = await listRow(orderId, "all")
      const onRetail = await api.get(`/partners/orders?kind=retail&limit=50`, partnerHeaders)

      // Came from core with the flag off, from work_order with it on.
      expect(offDetail.sales_channel_id).toBeTruthy()
      expect(onDetail.sales_channel_id).toBeNull()
      expect(offKind.row?.sales_channel_id).toBeTruthy()
      expect(onKind.row?.sales_channel_id).toBeNull()
      expect(onAll.row?.sales_channel_id).toBeNull()

      // ...and reads the same to partner-ui.
      expect(pickWorkOrderContract(onDetail)).toEqual(pickWorkOrderContract(offDetail))
      expect(pickWorkOrderListContract(onKind.row)).toEqual(pickWorkOrderListContract(offKind.row))
      expect(pickWorkOrderListContract(onAll.row)).toEqual(pickWorkOrderListContract(offAll.row))
      expect(onKind.count).toBe(offKind.count)
      expect(onAll.count).toBe(offAll.count)

      // Retail is never touched by the flag.
      expect(onRetail.data).toEqual(offRetail.data)
    }

    it("a DESIGN work order: detail, kind=design and kind=all read the same from work_order", async () => {
      const design = await post(
        "/admin/designs",
        {
          name: `Reads Design ${unique}`,
          description: "#2264",
          design_type: "Original",
          status: "Approved",
          priority: "Medium",
        },
        adminHeaders
      )
      const templateName = `wo-reads-design-${unique}`
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
          category: "WO Reads",
        },
        adminHeaders
      )
      const created = await post(
        `/admin/designs/${design.data.design.id}/production-runs`,
        {
          assignments: [
            { partner_id: partnerId, quantity: 4, role: "manufacturing", template_names: [templateName] },
          ],
        },
        adminHeaders
      )
      const runId = created.data.children?.[0]?.id ?? created.data.result?.children?.[0]?.id
      const orderId = await mirrorIdOf("production_runs", runId)
      await compareFlag(orderId, "design")
    })

    it("an INVENTORY work order: detail, kind=inventory and kind=all read the same from work_order", async () => {
      const res = await post(
        "/admin/inventory-orders",
        {
          order_lines: [{ inventory_item_id: inventoryItemId, quantity: 70.6, price: 690 }],
          quantity: 70.6,
          total_price: 48714,
          status: "Pending",
          expected_delivery_date: new Date().toISOString(),
          order_date: new Date().toISOString(),
          shipping_address: {
            first_name: "JYT",
            address_1: "Mill Road 1",
            city: "Jaipur",
            country_code: "in",
            postal_code: "302001",
          },
          stock_location_id: stockLocationId,
          from_stock_location_id: fromStockLocationId,
        },
        adminHeaders
      )
      const invId = res.data.inventoryOrder.id
      await post(`/admin/inventory-orders/${invId}/send-to-partner`, { partnerId, notes: "#2264" }, adminHeaders)
      const orderId = await mirrorIdOf("inventory_orders", invId)
      await compareFlag(orderId, "inventory")
    })

    it("another partner still cannot read the work order with the flag on", async () => {
      process.env.WORK_ORDER_READS = "true"
      const email = `wo-reads-other-${unique}@jyt.test`
      await post("/auth/partner/emailpass/register", { email, password: PASSWORD })
      const l1 = await post("/auth/partner/emailpass", { email, password: PASSWORD })
      await post(
        "/partners",
        { name: `Other ${unique}`, handle: `wo-other-${unique}`, admin: { email, first_name: "O", last_name: "P" } },
        { headers: { Authorization: `Bearer ${l1.data.token}` } }
      )
      const l2 = await post("/auth/partner/emailpass", { email, password: PASSWORD })
      const otherHeaders = { headers: { Authorization: `Bearer ${l2.data.token}` } }

      const res = await post(
        "/admin/inventory-orders",
        {
          order_lines: [{ inventory_item_id: inventoryItemId, quantity: 2, price: 10 }],
          quantity: 2,
          total_price: 20,
          status: "Pending",
          expected_delivery_date: new Date().toISOString(),
          order_date: new Date().toISOString(),
          shipping_address: { first_name: "J", address_1: "R", city: "J", country_code: "in", postal_code: "302001" },
          stock_location_id: stockLocationId,
          from_stock_location_id: fromStockLocationId,
        },
        adminHeaders
      )
      const invId = res.data.inventoryOrder.id
      await post(`/admin/inventory-orders/${invId}/send-to-partner`, { partnerId, notes: "#2264" }, adminHeaders)
      const orderId = await mirrorIdOf("inventory_orders", invId)

      const denied = await api.get(`/partners/orders/${orderId}`, otherHeaders).catch((e: any) => e.response)
      expect(denied.status).toBe(404)
      const list = await api.get(`/partners/orders?kind=inventory&limit=50`, otherHeaders)
      expect((list.data.orders || []).map((o: any) => o.id)).not.toContain(orderId)
    })
  })
})
