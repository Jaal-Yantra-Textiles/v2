/**
 * #342 Chunk 4 (T3.3) — admin retail list filter.
 *
 * The unified `order` table now holds three kinds of row, discriminated by which
 * execution link is present (D5):
 *   - design     → linked to a production_run
 *   - inventory  → linked to an inventory_order
 *   - retail     → NEITHER link (a real customer order)
 *
 * GET /admin/orders historically meant "customer orders", so the override route
 * defaults to retail and hides work-orders; `?kind=` opts them back in and
 * `?kind=all` restores the pre-D5 (unfiltered) behaviour. These cases assert the
 * filter by the SPECIFIC ids created here, so they are robust on the shared DB.
 */
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createOrderWorkflow } from "@medusajs/core-flows"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { ORDER_INVENTORY_MODULE } from "../../src/modules/inventory_orders"

jest.setTimeout(60000)

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Orders unification admin list filter (#342 Chunk 4)", () => {
    let adminHeaders: any
    let unique: number
    let regionId: string
    let salesChannelId: string
    let inventoryItemId: string
    let stockLocationId: string
    let fromStockLocationId: string

    const post = async (url: string, body: any, cfg?: any) => {
      try {
        return await api.post(url, body, cfg)
      } catch (err: any) {
        throw new Error(
          `POST ${url} failed: ${err?.response?.status} ${JSON.stringify(
            err?.response?.data
          )}`
        )
      }
    }

    // GET /admin/orders[?kind=], paged wide, returning the set of order ids.
    const listOrderIds = async (kind?: string): Promise<Set<string>> => {
      const q = kind ? `?kind=${kind}&limit=1000` : `?limit=1000`
      const res = await api.get(`/admin/orders${q}`, adminHeaders)
      expect(res.status).toBe(200)
      return new Set<string>(res.data.orders.map((o: any) => o.id))
    }

    const unifiedIdFromLegacy = async (
      entity: "inventory_orders" | "production_runs",
      id: string
    ): Promise<string> => {
      const query: any = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity,
        filters: { id },
        fields: ["id", "order.id", "metadata"],
      })
      const row = data?.[0]
      return row?.order?.id ?? row?.metadata?.unified_order_id
    }

    const createRetailOrder = async (): Promise<string> => {
      const { result } = await createOrderWorkflow(getContainer()).run({
        input: {
          region_id: regionId,
          sales_channel_id: salesChannelId,
          currency_code: "inr",
          email: `retail-${unique}@jyt.test`,
          items: [
            { title: "Retail Tee", quantity: 1, unit_price: 500 } as any,
          ],
        } as any,
      })
      return (result as any).id
    }

    const createInventoryWorkOrder = async (): Promise<string> => {
      const res = await post(
        "/admin/inventory-orders",
        {
          order_lines: [
            { inventory_item_id: inventoryItemId, quantity: 3, price: 100 },
          ],
          quantity: 3,
          total_price: 100,
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
      expect(res.status).toBe(201)
      return unifiedIdFromLegacy("inventory_orders", res.data.inventoryOrder.id)
    }

    const createDesignWorkOrder = async (): Promise<string> => {
      const design = await post(
        "/admin/designs",
        {
          name: `Chunk4 Design ${unique}`,
          description: "Design for #342 admin-list-filter test",
          design_type: "Original",
          status: "Approved",
          priority: "Medium",
        },
        adminHeaders
      )
      expect(design.status).toBe(201)
      const run = await post(
        `/admin/designs/${design.data.design.id}/production-runs`,
        {},
        adminHeaders
      )
      expect([200, 201]).toContain(run.status)
      const runId = run.data.productionRun?.id ?? run.data.production_run?.id
      return unifiedIdFromLegacy("production_runs", runId)
    }

    beforeEach(async () => {
      const container = getContainer()
      unique = Date.now()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)

      const region = await (container.resolve(Modules.REGION) as any).createRegions({
        name: "India",
        currency_code: "inr",
        countries: ["in"],
      })
      regionId = region.id

      const channel = await (
        container.resolve(Modules.SALES_CHANNEL) as any
      ).createSalesChannels({ name: `Chunk4 Channel ${unique}` })
      salesChannelId = channel.id

      const inv = await api.post(
        "/admin/inventory-items",
        { title: "Raw Cotton", sku: `RAW-COTTON-${unique}` },
        adminHeaders
      )
      inventoryItemId = inv.data.inventory_item.id

      const to = await api.post(
        "/admin/stock-locations",
        { name: `Main ${unique}` },
        adminHeaders
      )
      stockLocationId = to.data.stock_location.id
      const from = await api.post(
        "/admin/stock-locations",
        { name: `Secondary ${unique}` },
        adminHeaders
      )
      fromStockLocationId = from.data.stock_location.id
    })

    it("default list shows retail orders and hides work-orders", async () => {
      const retailId = await createRetailOrder()
      const inventoryId = await createInventoryWorkOrder()
      const designId = await createDesignWorkOrder()

      const ids = await listOrderIds()
      expect(ids.has(retailId)).toBe(true)
      expect(ids.has(inventoryId)).toBe(false)
      expect(ids.has(designId)).toBe(false)

      // ?kind=retail is the explicit form of the default.
      const retailIds = await listOrderIds("retail")
      expect(retailIds.has(retailId)).toBe(true)
      expect(retailIds.has(inventoryId)).toBe(false)
      expect(retailIds.has(designId)).toBe(false)
    })

    it("?kind=inventory surfaces only raw-material POs", async () => {
      const retailId = await createRetailOrder()
      const inventoryId = await createInventoryWorkOrder()
      const designId = await createDesignWorkOrder()

      const ids = await listOrderIds("inventory")
      expect(ids.has(inventoryId)).toBe(true)
      expect(ids.has(designId)).toBe(false)
      expect(ids.has(retailId)).toBe(false)
    })

    it("?kind=design surfaces only design work-orders", async () => {
      const retailId = await createRetailOrder()
      const inventoryId = await createInventoryWorkOrder()
      const designId = await createDesignWorkOrder()

      const ids = await listOrderIds("design")
      expect(ids.has(designId)).toBe(true)
      expect(ids.has(inventoryId)).toBe(false)
      expect(ids.has(retailId)).toBe(false)
    })

    it("?kind=all restores the pre-D5 unfiltered list", async () => {
      const retailId = await createRetailOrder()
      const inventoryId = await createInventoryWorkOrder()
      const designId = await createDesignWorkOrder()

      const ids = await listOrderIds("all")
      expect(ids.has(retailId)).toBe(true)
      expect(ids.has(inventoryId)).toBe(true)
      expect(ids.has(designId)).toBe(true)
    })
  })
})
