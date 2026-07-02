/**
 * Inventory-order line update persistence — core vs non-core.
 *
 * Motivated by a prod incident (inv_order_…M8SN / core order display #68): a
 * single "Edit Order Lines" save wiped ALL of an inventory order's lines while
 * the core mirror order kept its original items. This spec pins the actual
 * data behaviour on both sides so the regression can't recur silently:
 *
 *   1. Baseline — creating a legacy inventory order dual-writes a core order
 *      whose items mirror the lines at creation time.
 *   2. Correct update (add / edit / remove-one) persists on the non-core
 *      `inventory_order_line` table exactly as intended.
 *   3. The CORE mirror never re-syncs its items after creation — line changes
 *      on the inventory order do NOT propagate to core `order.items` (only
 *      status is mirrored). This is the "core survives, non-core changed"
 *      divergence the operator saw.
 *   4. Repro of the #855 form bug: the edit form used react-hook-form's
 *      `useFieldArray` field key (`fields[i].id`) as if it were the DB line id.
 *      Because those id-spaces never match, every save re-sent the existing
 *      lines under NON-matching ids (→ update no-op) AND emitted a removal
 *      marker for every real DB id (→ soft-delete). The net payload wipes the
 *      whole order. This test sends exactly that payload and asserts 0 lines
 *      remain on the inventory order while the core mirror is untouched.
 */
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(60000)

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Inventory-order line update persistence (core vs non-core)", () => {
    let adminHeaders: any
    let itemA: string
    let itemB: string
    let itemC: string
    let itemD: string
    let stockLocationId: string
    let fromStockLocationId: string

    const createItem = async (title: string, sku: string) => {
      const res = await api.post("/admin/inventory-items", { title, sku }, adminHeaders)
      expect(res.status).toBe(200)
      return res.data.inventory_item.id as string
    }

    const createRegion = async () => {
      const regionService: any = getContainer().resolve(Modules.REGION)
      await regionService
        .createRegions({ name: "India", currency_code: "inr", countries: ["in"] })
        .catch(() => undefined) // region may already exist on the shared DB
    }

    // Create a legacy inventory order with three lines (A, B, C).
    const createOrderWithThreeLines = async () => {
      const payload = {
        order_lines: [
          { inventory_item_id: itemA, quantity: 10, price: 100 },
          { inventory_item_id: itemB, quantity: 5, price: 200 },
          { inventory_item_id: itemC, quantity: 3, price: 50 },
        ],
        quantity: 18,
        total_price: 2150,
        status: "Pending",
        expected_delivery_date: new Date().toISOString(),
        order_date: new Date().toISOString(),
        shipping_address: {},
        stock_location_id: stockLocationId,
        from_stock_location_id: fromStockLocationId,
      }
      const res = await api.post("/admin/inventory-orders", payload, adminHeaders)
      expect(res.status).toBe(201)
      return res.data.inventoryOrder
    }

    // Non-core: live (non-deleted) lines on the inventory order.
    const fetchLegacyLines = async (id: string) => {
      const query: any = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "inventory_orders",
        filters: { id },
        fields: ["id", "quantity", "total_price", "orderlines.id", "orderlines.quantity", "orderlines.price"],
      })
      return data?.[0]
    }

    // Core mirror: resolve via the order↔inventory_order link, then read items.
    const resolveUnifiedOrderId = async (legacyId: string): Promise<string | undefined> => {
      const query: any = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "inventory_orders",
        filters: { id: legacyId },
        fields: ["id", "order.id"],
      })
      return data?.[0]?.order?.id ?? undefined
    }

    const fetchCoreItems = async (unifiedOrderId: string) => {
      const query: any = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "order",
        filters: { id: unifiedOrderId },
        // `items.*` (wildcard) is required for the calculated `total` to resolve.
        fields: ["id", "status", "total", "items.*"],
      })
      return data?.[0]
    }

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)
      await createRegion()

      itemA = await createItem("Tangaliya Dress Suit Material", `MAT-A-${Date.now()}`)
      itemB = await createItem("Tangaliya Shirt", `MAT-B-${Date.now()}`)
      itemC = await createItem("Cotton Thread", `MAT-C-${Date.now()}`)
      itemD = await createItem("Extra Material", `MAT-D-${Date.now()}`)

      const to = await api.post("/admin/stock-locations", { name: "Main Warehouse" }, adminHeaders)
      stockLocationId = to.data.stock_location.id
      const from = await api.post("/admin/stock-locations", { name: "Secondary Warehouse" }, adminHeaders)
      fromStockLocationId = from.data.stock_location.id
    })

    it("baseline: create dual-writes a core order mirroring the three lines", async () => {
      const legacy = await createOrderWithThreeLines()
      expect(legacy.orderlines).toHaveLength(3)

      const unifiedId = await resolveUnifiedOrderId(legacy.id)
      expect(unifiedId).toBeTruthy()
      const core = await fetchCoreItems(unifiedId!)
      expect(core.items).toHaveLength(3)
    })

    it("correct update (add a 4th line) persists all four lines on the inventory order", async () => {
      const legacy = await createOrderWithThreeLines()
      const [a, b, c] = legacy.orderlines

      // The payload a CORRECT form should send: existing lines carry their real
      // DB ids, plus one brand-new line with no id.
      const res = await api.put(
        `/admin/inventory-orders/${legacy.id}/order-lines`,
        {
          data: { quantity: 21, total_price: 2450 },
          order_lines: [
            { id: a.id, inventory_item_id: a.inventory_items?.[0]?.id ?? itemA, quantity: 10, price: 100 },
            { id: b.id, inventory_item_id: b.inventory_items?.[0]?.id ?? itemB, quantity: 5, price: 200 },
            { id: c.id, inventory_item_id: c.inventory_items?.[0]?.id ?? itemC, quantity: 3, price: 50 },
            { inventory_item_id: itemD, quantity: 3, price: 100 },
          ],
        },
        adminHeaders
      )
      expect(res.status).toBe(200)

      const after = await fetchLegacyLines(legacy.id)
      expect(after.orderlines).toHaveLength(4)
    })

    it("correct update (edit qty of an existing line) persists in place", async () => {
      const legacy = await createOrderWithThreeLines()
      const [a, b, c] = legacy.orderlines

      const res = await api.put(
        `/admin/inventory-orders/${legacy.id}/order-lines`,
        {
          order_lines: [
            { id: a.id, inventory_item_id: a.inventory_items?.[0]?.id ?? itemA, quantity: 99, price: 100 },
            { id: b.id, inventory_item_id: b.inventory_items?.[0]?.id ?? itemB, quantity: 5, price: 200 },
            { id: c.id, inventory_item_id: c.inventory_items?.[0]?.id ?? itemC, quantity: 3, price: 50 },
          ],
        },
        adminHeaders
      )
      expect(res.status).toBe(200)

      const after = await fetchLegacyLines(legacy.id)
      expect(after.orderlines).toHaveLength(3)
      const edited = after.orderlines.find((l: any) => l.id === a.id)
      expect(Number(edited.quantity)).toBe(99)
    })

    it("correct update (remove ONE line via marker) leaves the other two", async () => {
      const legacy = await createOrderWithThreeLines()
      const [a, b, c] = legacy.orderlines

      const res = await api.put(
        `/admin/inventory-orders/${legacy.id}/order-lines`,
        {
          order_lines: [
            { id: a.id, inventory_item_id: a.inventory_items?.[0]?.id ?? itemA, quantity: 10, price: 100 },
            { id: b.id, inventory_item_id: b.inventory_items?.[0]?.id ?? itemB, quantity: 5, price: 200 },
            { id: c.id, remove: true },
          ],
        },
        adminHeaders
      )
      expect(res.status).toBe(200)

      const after = await fetchLegacyLines(legacy.id)
      expect(after.orderlines).toHaveLength(2)
      expect(after.orderlines.map((l: any) => l.id).sort()).toEqual([a.id, b.id].sort())
    })

    it("REPRO #855: buggy payload wipes inventory lines; core mirror now re-syncs to match (no drift)", async () => {
      const legacy = await createOrderWithThreeLines()
      const lines = legacy.orderlines as any[]
      const unifiedId = await resolveUnifiedOrderId(legacy.id)
      expect(unifiedId).toBeTruthy()

      // Faithful reproduction of what edit-order-lines.tsx emitted:
      //  - "keep" entries re-sent under react-hook-form's field key (NOT the DB
      //    id) → truthy but non-matching → the workflow update-by-id no-ops.
      //  - a removal marker for every REAL DB id → soft-deletes every line.
      const keepEntriesWithWrongIds = lines.map((l, i) => ({
        id: `rhf-fieldarray-key-${i}`, // react-hook-form generated key, never a DB id
        inventory_item_id: l.inventory_items?.[0]?.id ?? itemA,
        quantity: l.quantity,
        price: l.price,
      }))
      const removalMarkers = lines.map((l) => ({ id: l.id, remove: true }))

      const res = await api.put(
        `/admin/inventory-orders/${legacy.id}/order-lines`,
        {
          // header totals still reflect the on-screen (pre-delete) lines — this
          // is why the operator saw a non-zero total over zero lines.
          data: { quantity: 18, total_price: 2150 },
          order_lines: [...keepEntriesWithWrongIds, ...removalMarkers],
        },
        adminHeaders
      )
      expect(res.status).toBe(200)

      // Non-core: every line is gone (the wipe still happens at the workflow
      // level when handed this payload — the real fix is client-side, so the
      // buggy payload can no longer be produced by the form).
      const after = await fetchLegacyLines(legacy.id)
      expect(after.orderlines).toHaveLength(0)
      // …yet the header total was still written from the on-screen figure.
      expect(Number(after.total_price)).toBe(2150)

      // Core mirror: NO LONGER drifts. The update workflow now re-projects the
      // mirror's items to match the live lines, so it follows the inventory
      // order down to zero instead of stranding the original three (this is the
      // systemic fix for the prod #68 "core kept old items" divergence).
      const core = await fetchCoreItems(unifiedId!)
      expect(core.items).toHaveLength(0)
    })

    it("core mirror re-projects on a correct edit (add one, drop one) to match the live lines", async () => {
      const legacy = await createOrderWithThreeLines()
      const [a, b, c] = legacy.orderlines
      const unifiedId = await resolveUnifiedOrderId(legacy.id)
      expect(unifiedId).toBeTruthy()
      expect((await fetchCoreItems(unifiedId!)).items).toHaveLength(3)

      // Keep A & B, drop C, add D — a well-formed edit.
      const res = await api.put(
        `/admin/inventory-orders/${legacy.id}/order-lines`,
        {
          order_lines: [
            { id: a.id, inventory_item_id: a.inventory_items?.[0]?.id ?? itemA, quantity: 10, price: 100 },
            { id: b.id, inventory_item_id: b.inventory_items?.[0]?.id ?? itemB, quantity: 5, price: 200 },
            { id: c.id, remove: true },
            { inventory_item_id: itemD, quantity: 3, price: 100 },
          ],
        },
        adminHeaders
      )
      expect(res.status).toBe(200)

      // Inventory order: A, B, D (3 lines).
      const afterInv = await fetchLegacyLines(legacy.id)
      expect(afterInv.orderlines).toHaveLength(3)

      // Core mirror now tracks the same 3 lines, and the total reflects them:
      // 10*100 + 5*200 + 3*100 = 2300.
      const core = await fetchCoreItems(unifiedId!)
      expect(core.items).toHaveLength(3)
      expect(Number(core.total)).toBe(2300)
    })
  })
})
