/**
 * #2286 follow-up — `audit-postings-at-source` reports where two-ended
 * inventory orders' goods landed, and changes nothing.
 */
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { auditPostingsAtSourceJob } from "../../src/api/admin/ops/maintenance-jobs/audit-postings-at-source-job"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { ensureHouseStoreRegion } from "../helpers/ensure-house-store-region"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(120000)

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("audit-postings-at-source (#2286)", () => {
    let adminHeaders: any
    let unique: number

    const post = async (url: string, body: any) => {
      try {
        return await api.post(url, body, adminHeaders)
      } catch (err: any) {
        throw new Error(`POST ${url} failed: ${err?.response?.status} ${JSON.stringify(err?.response?.data)}`)
      }
    }
    const loc = async (n: string) => (await post("/admin/stock-locations", { name: `${n} ${unique}` })).data.stock_location.id as string
    const item = async (t: string) =>
      (await post("/admin/inventory-items", { title: t, sku: `${t}-${unique}`.replace(/\s+/g, "-") })).data.inventory_item.id as string
    const order = async (from: string, to: string, itemId: string, qty: number) => {
      const res = await post("/admin/inventory-orders", {
        order_lines: [{ inventory_item_id: itemId, quantity: qty, price: 100 }],
        quantity: qty,
        total_price: qty * 100,
        status: "Pending",
        expected_delivery_date: new Date().toISOString(),
        order_date: new Date().toISOString(),
        shipping_address: {},
        stock_location_id: to,
        from_stock_location_id: from,
      })
      const id = res.data.inventoryOrder.id as string
      const svc: any = getContainer().resolve("inventory_orders")
      await svc.updateInventoryOrders({ id, status: "Delivered" })
      return id
    }
    const levels = async (itemId: string) => {
      const query: any = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "inventory_level",
        fields: ["id", "location_id", "stocked_quantity"],
        filters: { inventory_item_id: itemId },
      })
      return data as any[]
    }

    beforeEach(async () => {
      unique = Date.now()
      await createAdminUser(getContainer())
      await ensureHouseStoreRegion(getContainer())
      adminHeaders = await getAuthHeaders(api)
    })

    it("reports CONFIRMED and LIKELY source postings, skips a clean one, and writes nothing", async () => {
      const src = await loc("Supplier")
      const dst = await loc("Receiver")

      // CONFIRMED: a receipt row that really posted at the source.
      const i1 = await item("Confirmed Silk")
      const o1 = await order(src, dst, i1, 10)
      await post(`/admin/inventory-orders/${o1}/receive`, { stock_location_id: src })

      // LIKELY: received at the destination, then the stock sits at the source
      // (what the old supplier-Complete path left, with no location recorded).
      const i2 = await item("Likely Linen")
      const o2 = await order(src, dst, i2, 6)
      await post(`/admin/inventory-orders/${o2}/receive`, {})
      const inv: any = getContainer().resolve(Modules.INVENTORY)
      await inv.updateInventoryLevels([{ inventory_item_id: i2, location_id: dst, stocked_quantity: 0 }])
      await inv.createInventoryLevels([{ inventory_item_id: i2, location_id: src, stocked_quantity: 6 }])

      // CLEAN: received at the destination and still there.
      const i3 = await item("Clean Scarf")
      const o3 = await order(src, dst, i3, 4)
      await post(`/admin/inventory-orders/${o3}/receive`, {})

      const before = [await levels(i1), await levels(i2), await levels(i3)]
      const result = await auditPostingsAtSourceJob.run(getContainer(), { dry_run: false, params: {} } as any)
      const after = [await levels(i1), await levels(i2), await levels(i3)]

      const byOrder = (id: string) => result.changes.find((c) => String(c.id).startsWith(`${id}:`))
      expect(byOrder(o1)?.reason).toMatch(/^CONFIRMED/)
      expect(byOrder(o2)?.reason).toMatch(/^LIKELY/)
      expect(byOrder(o3)).toBeUndefined()

      // Reports only, even with dry_run=false.
      expect(result.applied).toBe(false)
      expect(after).toEqual(before)
    })
  })
})
