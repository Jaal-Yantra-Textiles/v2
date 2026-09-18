import {
  partnerUpdateOrderLinesSchema,
} from "../change-schemas"

/**
 * #1752 — what a partner may propose on an inventory order's lines.
 *
 * The quantity cases exist because these goods are cloth, yarn and trim:
 * `inventory_order_line.quantity` is a Postgres `real` (Migration20250821160920)
 * and a partner ordering 12.5 m was being refused by the validator alone.
 */
describe("partnerUpdateOrderLinesSchema — quantity", () => {
  const parse = (quantity: unknown) =>
    partnerUpdateOrderLinesSchema.safeParse({
      order_lines: [{ id: "ol_1", quantity, price: 100 }],
    })

  it.each([12.5, 0.5, 0.001, 1, 3, 1234.75])(
    "accepts %p — metres and kilograms are not whole numbers",
    (quantity) => {
      expect(parse(quantity).success).toBe(true)
    }
  )

  /**
   * 0 is refused ON PURPOSE. An emptied line is a removal, and `remove: true`
   * is how that is said. Two spellings for one intent would mean the approval
   * path soft-deletes one and leaves the other as a zero-quantity line sitting
   * in the payable ceiling's arithmetic.
   */
  it("refuses 0, and says to use the removal marker instead", () => {
    const res = parse(0)
    expect(res.success).toBe(false)
    expect(JSON.stringify(res.error?.issues)).toContain("mark it for removal")
  })

  it.each([-1, -0.5])("refuses the negative quantity %p", (quantity) => {
    expect(parse(quantity).success).toBe(false)
  })

  it("refuses a missing quantity on a kept line", () => {
    expect(
      partnerUpdateOrderLinesSchema.safeParse({
        order_lines: [{ id: "ol_1", price: 100 }],
      }).success
    ).toBe(false)
  })

  it("refuses NaN rather than letting it through as a number", () => {
    expect(parse(Number.NaN).success).toBe(false)
  })

  /**
   * A removal states no quantity at all, so the quantity rule must not fire on
   * it — that is what makes "remove" reachable from the UI's row model, where a
   * ticked row still carries whatever was in its quantity cell.
   */
  it("skips the quantity rule entirely for a line marked for removal", () => {
    expect(
      partnerUpdateOrderLinesSchema.safeParse({
        order_lines: [{ id: "ol_1", remove: true }],
      }).success
    ).toBe(true)
  })

  it("still requires a line id — a partner edits existing lines, never adds", () => {
    expect(
      partnerUpdateOrderLinesSchema.safeParse({
        order_lines: [{ quantity: 2, price: 100 }],
      }).success
    ).toBe(false)
  })

  it("still refuses a partner naming the order's own totals", () => {
    expect(
      partnerUpdateOrderLinesSchema.safeParse({
        order_lines: [{ id: "ol_1", quantity: 2, price: 100 }],
        data: { total_price: 1 },
      } as any).success
    ).toBe(false)
  })
})
