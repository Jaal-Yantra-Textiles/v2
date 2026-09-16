import {
  collectMirrorOrderIdsByMetadata,
  collectWorkOrderIds,
  MIRROR_LEGACY_ID_PREFIX,
} from "../route"

/**
 * 🔴 An inventory purchase order that reads as a customer sale (#342 / #2029).
 *
 * `/admin/orders` decides the order family by walking the EXECUTION table
 * (`inventory_orders`, `production_runs`) and collecting `order.id` off each
 * row — so it can only see work orders whose execution row still exists. Delete
 * the inventory order and its core mirror survives with nothing pointing at it:
 * collected by nobody, excluded from nothing, and the classifier's default
 * hands it to RETAIL.
 *
 * Found on production. `order_01M231KWSJGQS2V5AMDBDXGNEH` (#107, ₹14,000) was
 * one of EIGHT retail orders, while `inv_order_01M231KWG9CG5VQJHXCS36T0YH` —
 * the id its own metadata still names — 404s. Its twin #108, created seven
 * minutes later, is a real shipment in transit.
 *
 * The blob was never wrong. #2029 item 5 retired `metadata.unified_order_id` on
 * the reasoning that "prod: 0 rows depend on it" — true of that key, and read as
 * true of the whole blob. `legacy_id` is a different key and both dual-writes
 * still stamp it.
 */

/** A `query` whose graph returns canned rows per entity. */
const fakeQuery = (byEntity: Record<string, any[]>, throwOn?: string) => ({
  graph: async ({ entity }: { entity: string }) => {
    if (throwOn && entity === throwOn) throw new Error("graph unavailable")
    return { data: byEntity[entity] ?? [] }
  },
})

const order = (id: string, legacyId?: string) => ({
  id,
  metadata: legacyId ? { legacy_id: legacyId } : {},
})

describe("order kind — orphaned work-order mirrors", () => {
  describe("collectMirrorOrderIdsByMetadata", () => {
    it("🔴 finds the mirror whose execution row is gone, by its own legacy_id", async () => {
      const query = fakeQuery({
        orders: [
          order("order_107", "inv_order_GONE"),
          order("order_101"), // genuine retail
        ],
      })
      await expect(
        collectMirrorOrderIdsByMetadata(query, "inventory")
      ).resolves.toEqual(["order_107"])
    })

    it("does not confuse the two kinds", async () => {
      const query = fakeQuery({
        orders: [
          order("order_inv", "inv_order_1"),
          order("order_run", "prod_run_1"),
        ],
      })
      await expect(
        collectMirrorOrderIdsByMetadata(query, "inventory")
      ).resolves.toEqual(["order_inv"])
      await expect(
        collectMirrorOrderIdsByMetadata(query, "design")
      ).resolves.toEqual(["order_run"])
    })

    /**
     * ⚠️ A genuine retail order carries no `legacy_id` at all. Measured on
     * production before shipping: 7 of the 8 then-retail orders had none, and
     * the eighth was #107.
     */
    it("leaves a genuine retail order alone", async () => {
      const query = fakeQuery({ orders: [order("order_101"), order("order_83")] })
      await expect(
        collectMirrorOrderIdsByMetadata(query, "inventory")
      ).resolves.toEqual([])
    })

    it("ignores a metadata blob that is absent or not a string", async () => {
      const query = fakeQuery({
        orders: [
          { id: "order_a" },
          { id: "order_b", metadata: null },
          { id: "order_c", metadata: { legacy_id: 42 } },
        ],
      })
      await expect(
        collectMirrorOrderIdsByMetadata(query, "inventory")
      ).resolves.toEqual([])
    })
  })

  describe("collectWorkOrderIds", () => {
    it("unions the linked rows with the orphans, without duplicating", async () => {
      const query = fakeQuery({
        inventory_orders: [
          { id: "inv_live", order: { id: "order_108" } },
          { id: "inv_also", order: { id: "order_103" } },
        ],
        orders: [
          order("order_108", "inv_order_live"), // linked AND stamped
          order("order_107", "inv_order_GONE"), // orphan
          order("order_101"),
        ],
      })
      const ids = await collectWorkOrderIds(query, "inventory")
      expect(ids.sort()).toEqual(["order_103", "order_107", "order_108"])
    })

    /**
     * 🔴 The link stays authoritative. This is a safety net, so a failure to
     * read the blob must degrade to today's behaviour — never empty the list,
     * which on the `retail` path would exclude nothing and show work orders as
     * sales, the very fault being fixed.
     */
    it("🔴 falls back to the links alone when the metadata read fails", async () => {
      const query = fakeQuery(
        {
          inventory_orders: [{ id: "inv_live", order: { id: "order_108" } }],
          orders: [order("order_107", "inv_order_GONE")],
        },
        "orders"
      )
      await expect(collectWorkOrderIds(query, "inventory")).resolves.toEqual([
        "order_108",
      ])
    })

    it("is strictly additive — it never drops a linked order", async () => {
      const query = fakeQuery({
        inventory_orders: [{ id: "inv_live", order: { id: "order_108" } }],
        orders: [order("order_108")], // linked, but carries no legacy_id
      })
      await expect(collectWorkOrderIds(query, "inventory")).resolves.toEqual([
        "order_108",
      ])
    })
  })

  it("names the prefixes both dual-writes actually stamp", () => {
    expect(MIRROR_LEGACY_ID_PREFIX).toEqual({
      design: "prod_run_",
      inventory: "inv_order_",
    })
  })
})
