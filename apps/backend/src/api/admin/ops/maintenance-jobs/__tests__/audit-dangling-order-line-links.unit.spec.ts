import {
  DANGLING_LINK_TABLES,
  summarizeDangling,
} from "../audit-dangling-order-line-links-job"

/**
 * #2159 — the job exists to produce a NUMBER, so the thing most worth pinning
 * is the one case where the number lies: a table the lookup never found
 * reports zero rows, which is the same output as a clean table and the
 * opposite fact.
 */
describe("summarizeDangling", () => {
  it("reports a clean result when nothing dangles and every table was found", () => {
    expect(summarizeDangling(true, 0, [])).toBe(
      "No link rows point at a deleted order line."
    )
  })

  it("🔴 does NOT report clean when a table could not be found", () => {
    const msg = summarizeDangling(true, 0, ["product_variant"])
    expect(msg).toContain("Could not find a table")
    expect(msg).toContain("product_variant")
    // The distinction that matters: an unasked question must not read as a pass.
    expect(msg).toContain("NOT a clean result")
  })

  it("still warns about a missing table alongside a non-zero count", () => {
    const msg = summarizeDangling(true, 4, ["inventory_item"])
    expect(msg).toContain("Would dismiss 4 link rows")
    expect(msg).toContain("Could not find a table")
  })

  it("says 'Would dismiss' on a preview and 'Dismissed' on an apply", () => {
    expect(summarizeDangling(true, 2, [])).toContain("Would dismiss 2 link rows")
    expect(summarizeDangling(false, 2, [])).toContain("Dismissed 2 link rows")
  })

  it("keeps the singular readable", () => {
    expect(summarizeDangling(true, 1, [])).toContain("1 link row pointing")
  })
})

/**
 * The table names are matched by PREFIX because Medusa abbreviates and hashes
 * a long link table name. Pinning the prefixes keeps a rename from silently
 * turning both sweeps into "found nothing".
 */
describe("DANGLING_LINK_TABLES", () => {
  it("matches the real, hashed table names by prefix", () => {
    expect(
      "inventory_orders_inventory_order_line_inventory_-169f20608".startsWith(
        DANGLING_LINK_TABLES.inventory_item.prefix
      )
    ).toBe(true)
    expect(
      "inventory_orders_inventory_order_line_product_va-116a6f57c".startsWith(
        DANGLING_LINK_TABLES.product_variant.prefix
      )
    ).toBe(true)
  })

  it("does not let one prefix match the other's table", () => {
    expect(
      "inventory_orders_inventory_order_line_product_va-116a6f57c".startsWith(
        DANGLING_LINK_TABLES.inventory_item.prefix
      )
    ).toBe(false)
  })

  it("names the column that carries the other side of each link", () => {
    expect(DANGLING_LINK_TABLES.inventory_item.other_column).toBe(
      "inventory_item_id"
    )
    expect(DANGLING_LINK_TABLES.product_variant.other_column).toBe(
      "product_variant_id"
    )
  })
})
