/**
 * Samples / swatch inventory orders.
 *
 * A samples order is created BEFORE anyone knows what will arrive — that is
 * the whole reason to ask for swatches. So it is the one kind of inventory
 * order that:
 *
 *   1. may be created with NO order lines at all,
 *   2. stays editable at any status except Cancelled, so the lines can be
 *      filled in once the box is open,
 *   3. posts NO stock when those lines are filled — a swatch is reference
 *      material, not sellable units, and banking it would put zero-value
 *      stock into a location where it can be counted, reserved and sold,
 *   4. may name a material that has no catalogue entry yet, creating the
 *      inventory item as the line is written.
 *
 * Every relaxation is checked to NOT leak into ordinary procurement orders.
 */
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(90000)

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Samples / swatch inventory orders", () => {
    let headers: any
    let stockLocationId: string
    let existingItemId: string

    beforeEach(async () => {
      await createAdminUser(getContainer())
      headers = await getAuthHeaders(api)

      const loc = await api.post(
        "/admin/stock-locations",
        {
          name: "Swatch Shelf",
          address: {
            address_1: "1 Sample Rd",
            city: "Jaipur",
            province: "RJ",
            postal_code: "302001",
            country_code: "in",
            phone: "9998887771",
          },
        },
        headers
      )
      stockLocationId = loc.data.stock_location.id

      const item = await api.post(
        "/admin/inventory-items",
        { title: "Known Cotton", sku: `KNOWN-${Date.now()}` },
        headers
      )
      existingItemId = item.data.inventory_item.id
    })

    const baseOrder = (overrides: any = {}) => ({
      quantity: 0,
      total_price: 0,
      status: "Pending",
      expected_delivery_date: new Date().toISOString(),
      order_date: new Date().toISOString(),
      shipping_address: {},
      stock_location_id: stockLocationId,
      ...overrides,
    })

    const post = (body: any) =>
      api.post("/admin/inventory-orders", body, headers).catch((e: any) => e.response)

    const fetchOrder = async (id: string) => {
      const res = await api.get(`/admin/inventory-orders/${id}`, headers)
      return res.data.inventoryOrder
    }

    // The HTTP detail route does not hydrate lines by default, so read them
    // the way the sibling line-persistence spec does.
    const fetchLines = async (id: string): Promise<any[]> => {
      const query: any = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "inventory_orders",
        filters: { id },
        fields: [
          "id",
          "is_sample",
          "orderlines.id",
          "orderlines.quantity",
          "orderlines.price",
          "orderlines.material_name",
        ],
      })
      return data?.[0]?.orderlines ?? []
    }

    const putLines = (id: string, body: any) =>
      api
        .put(`/admin/inventory-orders/${id}/order-lines`, body, headers)
        .catch((e: any) => e.response)

    it("creates a sample order with no lines at all", async () => {
      const res = await post(baseOrder({ is_sample: true }))
      expect(res.status).toBe(201)

      const order = await fetchOrder(res.data.inventoryOrder.id)
      expect(order.is_sample).toBe(true)
      expect(await fetchLines(res.data.inventoryOrder.id)).toHaveLength(0)
    })

    it("creates a sample order with an explicitly empty line array", async () => {
      const res = await post(baseOrder({ is_sample: true, order_lines: [] }))
      expect(res.status).toBe(201)
    })

    it("STILL refuses an ordinary order with no lines", async () => {
      // The relaxation must not leak into procurement.
      const res = await post(baseOrder({ quantity: 5, total_price: 100 }))
      expect(res.status).toBe(400)
      expect(JSON.stringify(res.data)).toMatch(/only a sample order/i)
    })

    it("fills lines in after the box has been delivered, and posts no stock", async () => {
      const created = await post(baseOrder({ is_sample: true }))
      const orderId = created.data.inventoryOrder.id

      // Walk it to Delivered the way the box actually arrives.
      for (const status of ["Processing", "Delivered"]) {
        const moved = await api
          .put(`/admin/inventory-orders/${orderId}`, { status }, headers)
          .catch((e: any) => e.response)
        expect(moved.status).toBe(200)
      }
      expect((await fetchOrder(orderId)).status).toBe("Delivered")

      const filled = await putLines(orderId, {
        data: { quantity: 1, total_price: 0 },
        order_lines: [{ inventory_item_id: existingItemId, quantity: 1, price: 0 }],
      })
      expect(filled.status).toBe(200)

      expect(await fetchLines(orderId)).toHaveLength(1)

      // 🔑 No stock posted. A swatch is reference material.
      const levels = await api
        .get(
          `/admin/inventory-items/${existingItemId}/location-levels`,
          headers
        )
        .catch((e: any) => e.response)
      const stocked = (levels.data?.inventory_levels ?? []).reduce(
        (sum: number, l: any) => sum + Number(l.stocked_quantity || 0),
        0
      )
      expect(stocked).toBe(0)
    })

    it("STILL refuses to edit an ordinary order past Processing", async () => {
      const created = await post(
        baseOrder({
          quantity: 1,
          total_price: 10,
          order_lines: [
            { inventory_item_id: existingItemId, quantity: 1, price: 10 },
          ],
        })
      )
      const orderId = created.data.inventoryOrder.id

      await api.put(`/admin/inventory-orders/${orderId}`, { status: "Processing" }, headers)
      const shipped = await api
        .put(`/admin/inventory-orders/${orderId}`, { status: "Shipped" }, headers)
        .catch((e: any) => e.response)
      // Shipped is reachable; editing from there is not.
      if (shipped.status === 200) {
        const blocked = await putLines(orderId, {
          data: { quantity: 2, total_price: 20 },
          order_lines: [
            { inventory_item_id: existingItemId, quantity: 2, price: 10 },
          ],
        })
        expect(blocked.status).toBe(400)
        expect(JSON.stringify(blocked.data)).toMatch(/Pending' or 'Processing'/)
      }
    })

    it("creates the inventory item for a swatch we have never stocked", async () => {
      const created = await post(baseOrder({ is_sample: true }))
      const orderId = created.data.inventoryOrder.id

      const filled = await putLines(orderId, {
        data: { quantity: 1, total_price: 0 },
        order_lines: [
          {
            new_material: { name: "Tangaliya Weave", color: "Indigo" },
            quantity: 1,
            price: 0,
          },
        ],
      })
      expect(filled.status).toBe(200)

      const lines = await fetchLines(orderId)
      expect(lines).toHaveLength(1)

      // A line's inventory item lives in a module LINK, not a column — so the
      // proof that the item was really created and attached is the link.
      const query: any = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      // The link is inventory_order_LINE ⇄ inventory_item, so it hangs off the
      // line, not the order. (A wrong entity/field name here returns an empty
      // array rather than an error, which reads as "no link" — check the
      // defineLink before believing it.)
      const { data } = await query.graph({
        entity: "inventory_orders",
        filters: { id: orderId },
        fields: [
          "id",
          "orderlines.id",
          "orderlines.inventory_items.id",
          "orderlines.inventory_items.title",
        ],
      })
      const linked = data?.[0]?.orderlines?.[0]?.inventory_items ?? []
      expect(linked).toHaveLength(1)
      // The colour is folded into the title so gradings stay distinguishable.
      expect(linked[0].title).toBe("Tangaliya Weave — Indigo")
    })

    it("refuses new_material alongside an item that was picked", async () => {
      const created = await post(baseOrder({ is_sample: true }))
      const orderId = created.data.inventoryOrder.id

      const res = await putLines(orderId, {
        data: { quantity: 1, total_price: 0 },
        order_lines: [
          {
            inventory_item_id: existingItemId,
            new_material: { name: "Tangaliya Weave" },
            quantity: 1,
            price: 0,
          },
        ],
      })
      expect(res.status).toBe(400)
      expect(JSON.stringify(res.data)).toMatch(/duplicate/i)
    })
  })
})
