import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"

jest.setTimeout(90 * 1000)

/**
 * #1613 scope item 4 — populating the material identity that pre-#817 order
 * lines never got.
 *
 * `color` / `material_name` / `raw_material_id` are denormalized onto a line at
 * CREATE time from the linked inventory item's raw material. Lines written
 * before that shipped hold NULL in all three, so the order cannot say what
 * material any of its lines is for — all ten lines on
 * `inv_order_01K36TE2WB5BQR1MS6KESXP7Q3` are in exactly that state.
 *
 * ## Why this drives the real job rather than asserting a clean dry run
 *
 * "Scanned N orders, found 0" passes on an empty database whatever the job
 * does, including nothing. So the fixture MANUFACTURES the defect: create the
 * order normally (so #817 populates the columns and the module link exists),
 * then null the columns back out through the module service. That is the
 * pre-#817 row, reachable in a test, and the assertion is that the values come
 * back — from the link, not from anything the test told the job.
 */
setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("backfill-order-line-material (#1613)", () => {
    let headers: { headers: Record<string, string> }
    let stockLocationId: string

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      headers = await getAuthHeaders(api)

      const loc = await api.post(
        "/admin/stock-locations",
        { name: "Material Backfill Warehouse" },
        headers
      )
      stockLocationId = loc.data.stock_location.id
    })

    /**
     * An inventory item WITH a linked raw material, plus an order line that
     * points at it — then the line's material columns nulled out.
     *
     * Returns the ids, and the values #817 had put there, so the assertion can
     * compare against what the create path itself produced rather than against
     * a string this test invented. If the backfill and the creator ever
     * disagree, that is the failure worth catching.
     */
    const seedPreTagLine = async (color: string, name: string) => {
      const imported = await api.post(
        "/admin/inventory-items/bulk-import",
        {
          items: [
            {
              name,
              composition: "100% Cotton",
              color,
              unit_of_measure: "Meter",
              material_type: "Cotton",
            },
          ],
          stock_location_id: stockLocationId,
        },
        headers
      )
      expect(imported.status).toBe(201)
      const itemId = imported.data.created[0].inventory_item.id

      const order = await api.post(
        "/admin/inventory-orders",
        {
          order_lines: [{ inventory_item_id: itemId, quantity: 5, price: 300 }],
          quantity: 5,
          total_price: 1500,
          status: "Pending",
          expected_delivery_date: new Date().toISOString(),
          order_date: new Date().toISOString(),
          shipping_address: {},
          stock_location_id: stockLocationId,
        },
        headers
      )
      expect(order.status).toBe(201)
      const orderId = order.data.inventoryOrder.id

      const service: any = getContainer().resolve("inventory_orders")
      const [line] = await service.listInventoryOrderLines(
        { inventory_orders_id: orderId },
        { select: ["id", "color", "material_name", "raw_material_id"] }
      )
      expect(line).toBeDefined()

      // What #817 wrote at creation — the answer the backfill has to reproduce.
      const asCreated = {
        color: line.color,
        material_name: line.material_name,
        raw_material_id: line.raw_material_id,
      }
      expect(asCreated.raw_material_id).toBeTruthy()

      // …and now the pre-#817 row.
      await service.updateOrderLines({
        id: line.id,
        color: null,
        material_name: null,
        raw_material_id: null,
      })

      return { orderId, lineId: line.id, itemId, asCreated, service }
    }

    it("reports the missing fields without writing when dry_run is true", async () => {
      const { orderId, lineId } = await seedPreTagLine("Dusty Rose", "Organic Kala Cotton")

      const res = await api.post(
        "/admin/ops/maintenance-jobs/backfill-order-line-material/run",
        { dry_run: true, params: { order_id: orderId } },
        headers
      )
      expect(res.status).toBe(200)
      expect(res.data.result.applied).toBe(false)
      expect(res.data.result.summary).toContain("Nothing was changed")

      const fields = res.data.result.changes
        .filter((c: any) => c.id === lineId)
        .map((c: any) => c.field)
        .sort()
      expect(fields).toEqual(["color", "material_name", "raw_material_id"])

      // 🔴 And the row is untouched. A "dry run" that writes is the one failure
      // this job must never have.
      const service: any = getContainer().resolve("inventory_orders")
      const [after] = await service.listInventoryOrderLines(
        { id: lineId },
        { select: ["id", "color", "material_name", "raw_material_id"] }
      )
      expect(after.color).toBeNull()
      expect(after.material_name).toBeNull()
      expect(after.raw_material_id).toBeNull()
    })

    it("writes exactly what the create path would have written", async () => {
      const { orderId, lineId, asCreated, service } = await seedPreTagLine(
        "Indigo",
        "Handloom Muslin"
      )

      const res = await api.post(
        "/admin/ops/maintenance-jobs/backfill-order-line-material/run",
        { dry_run: false, params: { order_id: orderId } },
        headers
      )
      expect(res.status).toBe(200)
      expect(res.data.result.applied).toBe(true)
      expect(res.data.result.errors).toBeUndefined()

      const [after] = await service.listInventoryOrderLines(
        { id: lineId },
        { select: ["id", "color", "material_name", "raw_material_id"] }
      )
      // 🔑 Compared against what #817 itself produced, not against a literal
      // this test chose. The backfill must not hold a second opinion.
      expect(after.color).toBe(asCreated.color)
      expect(after.material_name).toBe(asCreated.material_name)
      expect(after.raw_material_id).toBe(asCreated.raw_material_id)
    })

    it("is idempotent — a second run finds nothing left to do", async () => {
      const { orderId } = await seedPreTagLine("Madder Red", "Khadi Cotton")

      await api.post(
        "/admin/ops/maintenance-jobs/backfill-order-line-material/run",
        { dry_run: false, params: { order_id: orderId } },
        headers
      )

      const second = await api.post(
        "/admin/ops/maintenance-jobs/backfill-order-line-material/run",
        { dry_run: false, params: { order_id: orderId } },
        headers
      )
      expect(second.data.result.changes).toEqual([])
      expect(second.data.result.applied).toBe(false)
    })

    it("never overwrites a value someone already set", async () => {
      // 🔴 A populated column is somebody's answer. The link is the source for
      // a line that never got one, not a licence to correct one that did.
      const { orderId, lineId, asCreated, service } = await seedPreTagLine(
        "Ivory",
        "Tussar Silk"
      )
      await service.updateOrderLines({ id: lineId, color: "Hand-corrected" })

      await api.post(
        "/admin/ops/maintenance-jobs/backfill-order-line-material/run",
        { dry_run: false, params: { order_id: orderId } },
        headers
      )

      const [after] = await service.listInventoryOrderLines(
        { id: lineId },
        { select: ["id", "color", "material_name", "raw_material_id"] }
      )
      expect(after.color).toBe("Hand-corrected")
      // …while the fields that WERE empty are still filled.
      expect(after.material_name).toBe(asCreated.material_name)
      expect(after.raw_material_id).toBe(asCreated.raw_material_id)
    })

    it("404s on an unknown order rather than reporting a clean scan", async () => {
      await expect(
        api.post(
          "/admin/ops/maintenance-jobs/backfill-order-line-material/run",
          { dry_run: true, params: { order_id: "inv_order_does_not_exist" } },
          headers
        )
      ).rejects.toMatchObject({ response: { status: 404 } })
    })
  })
})
