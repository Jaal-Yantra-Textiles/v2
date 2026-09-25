/**
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

  describe("work_order parity with the core-order mirror (#2262 S0)", () => {
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

    it("a DESIGN work order reads the same from work_order as from the mirror", async () => {
      const design = await post(
        "/admin/designs",
        {
          name: `Parity Design ${unique}`,
          description: "#2262 parity",
          design_type: "Original",
          status: "Approved",
          priority: "Medium",
        },
        adminHeaders
      )
      const templateName = `wo-parity-design-${unique}`
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
          category: "WO Parity",
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
      const runId =
        created.data.children?.[0]?.id ?? created.data.result?.children?.[0]?.id
      expect(runId).toBeTruthy()
      const orderId = await mirrorIdOf("production_runs", runId)

      const before = await oldDetail(orderId)
      const beforeRow = await oldListRow(orderId, "design")
      const { stored, served } = await persistAndServe(orderId)

      expect(stored.kind).toBe("design")
      expect(stored.partner_id).toBe(partnerId)
      expect(stored).not.toHaveProperty("metadata")
      // The real link and the read-only links all resolve:
      expect(stored.production_runs.map((r: any) => r.id)).toEqual([runId])
      expect(stored.partner?.id).toBe(partnerId)
      expect(stored.items[0].production_run?.id).toBe(runId)
      expect(stored.items[0].design?.id).toBe(design.data.design.id)
      expect(stored.items[0]).not.toHaveProperty("metadata")

      expect(pickWorkOrderContract(served)).toEqual(pickWorkOrderContract(before))
      expect(pickWorkOrderListContract(served)).toEqual(pickWorkOrderListContract(beforeRow))
    })

    it("an INVENTORY work order (fractional metres) reads the same from work_order as from the mirror", async () => {
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
      await post(
        `/admin/inventory-orders/${invId}/send-to-partner`,
        { partnerId, notes: "#2262 parity" },
        adminHeaders
      )
      const orderId = await mirrorIdOf("inventory_orders", invId)

      const before = await oldDetail(orderId)
      const beforeRow = await oldListRow(orderId, "inventory")
      const { stored, served } = await persistAndServe(orderId)

      expect(stored.kind).toBe("inventory")
      expect(stored.inventory_order_id).toBe(invId)
      expect(stored.inventory_orders?.id ?? stored.inventory_orders?.[0]?.id).toBe(invId)
      expect(stored.partner?.id).toBe(partnerId)
      expect(stored.items[0].inventory_order_line_id).toBeTruthy()
      expect(Number(stored.items[0].quantity)).toBe(70.6)

      expect(pickWorkOrderContract(served)).toEqual(pickWorkOrderContract(before))
      expect(pickWorkOrderListContract(served)).toEqual(pickWorkOrderListContract(beforeRow))
    })
  })
})
