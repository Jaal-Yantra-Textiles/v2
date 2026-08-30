import { inventoryOrderFormSchema } from "../create-inventory-order-schema"

/**
 * #1671. The create form SEEDS the grid with five blank rows. The schema used
 * to validate every element, so those blanks failed `inventory_item_id` and
 * `quantity` — `handleSubmit`'s callback never ran and Create did nothing,
 * silently, unless the buyer deleted four rows by hand. Confirmed in the
 * browser: zero network requests with the blanks present, 201 once removed.
 *
 * The rule pinned here: a row is either BLANK (ignored) or COMPLETE.
 */
const BLANK = { inventory_item_id: "", quantity: 0, price: 0 }

const base = {
  order_date: new Date("2026-08-30"),
  expected_delivery_date: new Date("2026-12-31"),
  stock_location_id: "sloc_1",
  is_sample: false,
}

const seededWith = (...filled: any[]) => ({
  ...base,
  // Exactly what the form ships with: five rows, most of them untouched.
  order_lines: [
    ...filled,
    ...Array.from({ length: 5 - filled.length }, () => ({ ...BLANK })),
  ],
})

describe("inventoryOrderFormSchema — seeded blank rows (#1671)", () => {
  it("accepts one filled row among the four blanks the form seeds", () => {
    const result = inventoryOrderFormSchema.safeParse(
      seededWith({ inventory_item_id: "iitem_1", quantity: 40, price: 120 })
    )
    expect(result.success).toBe(true)
  })

  it("accepts an untracked-variant pick, whose id is the synthetic picker value", () => {
    const result = inventoryOrderFormSchema.safeParse(
      seededWith({
        inventory_item_id: "untracked_variant:variant_1",
        quantity: 5,
        price: 10,
      })
    )
    expect(result.success).toBe(true)
  })

  it("refuses an order with nothing picked at all", () => {
    const result = inventoryOrderFormSchema.safeParse(seededWith())
    expect(result.success).toBe(false)
    expect(
      result.success ? [] : result.error.issues.map((i) => i.message)
    ).toContain("Pick at least one item")
  })

  it("still refuses a picked row with no quantity — blanks are ignored, unfinished rows are not", () => {
    const result = inventoryOrderFormSchema.safeParse(
      seededWith({ inventory_item_id: "iitem_1", quantity: 0, price: 120 })
    )
    expect(result.success).toBe(false)
    const issue = result.success
      ? undefined
      : result.error.issues.find((i) => i.message.includes("Quantity"))
    expect(issue).toBeDefined()
    // Reported against the row the buyer must fix, not the array.
    expect(issue!.path).toEqual(["order_lines", 0, "quantity"])
  })

  it("reports the failing row's real index, not its position among filled rows", () => {
    const result = inventoryOrderFormSchema.safeParse({
      ...base,
      order_lines: [
        { ...BLANK },
        { inventory_item_id: "iitem_ok", quantity: 2, price: 5 },
        { ...BLANK },
        { inventory_item_id: "iitem_bad", quantity: 0, price: 5 },
        { ...BLANK },
      ],
    })
    expect(result.success).toBe(false)
    const issue = result.success
      ? undefined
      : result.error.issues.find((i) => i.message.includes("Quantity"))
    expect(issue!.path).toEqual(["order_lines", 3, "quantity"])
  })

  it("refuses a negative price on a picked row", () => {
    const result = inventoryOrderFormSchema.safeParse(
      seededWith({ inventory_item_id: "iitem_1", quantity: 1, price: -5 })
    )
    expect(result.success).toBe(false)
  })
})
