/**
 * #342 Chunk 9b (PR-F → PR-H) — `partner_status` on a typed sidecar column.
 *
 * PR-F was the EXPAND step of an expand→migrate→contract column swap; PR-H is the
 * CONTRACT step. After PR-H every status transition writes `partner_status` ONLY
 * onto the 1:1 `unified_order_status` sidecar row (linked via
 * order↔unified_order_status) — the `order.metadata.partner_status` copy is no
 * longer written at all. This proves the column is the sole surface: after each
 * transition the sidecar carries the §5 status while `metadata.partner_status`
 * stays undefined, and repeated transitions UPDATE the one row (the
 * find-or-create upsert never forks a second sidecar).
 */
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(60000)

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Orders unification status column (#342 PR-F / Chunk 9b)", () => {
    let adminHeaders: any
    let inventoryItemId: string
    let stockLocationId: string
    let fromStockLocationId: string

    const createRegion = async () => {
      const regionService: any = getContainer().resolve(Modules.REGION)
      const region = await regionService.createRegions({
        name: "India",
        currency_code: "inr",
        countries: ["in"],
      })
      return region.id
    }

    const createLegacyOrder = async () => {
      const res = await api.post(
        "/admin/inventory-orders",
        {
          order_lines: [
            { inventory_item_id: inventoryItemId, quantity: 1, price: 100 },
          ],
          quantity: 1,
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
      return res.data.inventoryOrder
    }

    const resolveUnifiedViaLink = async (
      legacyId: string
    ): Promise<string | undefined> => {
      const query: any = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "inventory_orders",
        filters: { id: legacyId },
        fields: ["id", "order.id"],
      })
      return data?.[0]?.order?.id ?? undefined
    }

    // Read the unified order's metadata + its linked sidecar status in one shot.
    const readStatuses = async (unifiedOrderId: string) => {
      const query: any = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "order",
        filters: { id: unifiedOrderId },
        fields: [
          "id",
          "metadata",
          "unified_order_status.id",
          "unified_order_status.partner_status",
        ],
      })
      return {
        metaStatus: data?.[0]?.metadata?.partner_status,
        sidecar: data?.[0]?.unified_order_status,
      }
    }

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)

      const inventoryRes = await api.post(
        "/admin/inventory-items",
        { title: "Raw Cotton", sku: "RAW-COTTON-KG" },
        adminHeaders
      )
      expect(inventoryRes.status).toBe(200)
      inventoryItemId = inventoryRes.data.inventory_item.id

      const toLocation = await api.post(
        "/admin/stock-locations",
        { name: "Main Warehouse" },
        adminHeaders
      )
      stockLocationId = toLocation.data.stock_location.id
      const fromLocation = await api.post(
        "/admin/stock-locations",
        { name: "Secondary Warehouse" },
        adminHeaders
      )
      fromStockLocationId = fromLocation.data.stock_location.id
    })

    it("writes partner_status ONLY to the sidecar column (never metadata), updating one row across transitions", async () => {
      await createRegion()
      const legacy = await createLegacyOrder()
      const unifiedOrderId = await resolveUnifiedViaLink(legacy.id)
      expect(unifiedOrderId).toBeTruthy()

      // Create-time: no partner assigned yet → no partner_status on either
      // surface (the §5 work dimension only exists once work is tracked).
      let snap = await readStatuses(unifiedOrderId!)
      expect(snap.metaStatus).toBeUndefined()
      expect(snap.sidecar).toBeFalsy()

      // Pending → Processing → §5 partner_status "in_progress" on the sidecar
      // column. PR-H: metadata is NEVER written.
      const res1 = await api.put(
        `/admin/inventory-orders/${legacy.id}`,
        { status: "Processing" },
        adminHeaders
      )
      expect(res1.status).toBe(200)
      snap = await readStatuses(unifiedOrderId!)
      expect(snap.sidecar?.partner_status).toBe("in_progress")
      expect(snap.metaStatus).toBeUndefined()
      const sidecarId = snap.sidecar?.id
      expect(sidecarId).toBeTruthy()

      // Processing → Shipped → "finished": the SAME sidecar row is updated
      // (find-or-create upserts; it never forks a second row).
      const res2 = await api.put(
        `/admin/inventory-orders/${legacy.id}`,
        { status: "Shipped" },
        adminHeaders
      )
      expect(res2.status).toBe(200)
      snap = await readStatuses(unifiedOrderId!)
      expect(snap.sidecar?.partner_status).toBe("finished")
      expect(snap.metaStatus).toBeUndefined()
      expect(snap.sidecar?.id).toBe(sidecarId)
    })
  })
})
