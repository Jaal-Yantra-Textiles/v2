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

/**
 * Samples/swatch orders. Ordered precisely because nobody knows what will
 * arrive, so the create form must accept one with nothing filled in — the
 * five seeded blank rows and all.
 */
describe("a sample order may be created with no items picked", () => {
  const blankGrid = {
    ...base,
    is_sample: true,
    order_lines: Array.from({ length: 5 }, () => ({ ...BLANK })),
  }

  it("accepts the untouched grid when is_sample is on", () => {
    expect(inventoryOrderFormSchema.safeParse(blankGrid).success).toBe(true)
  })

  it("accepts a sample with an empty grid", () => {
    expect(
      inventoryOrderFormSchema.safeParse({ ...blankGrid, order_lines: [] }).success
    ).toBe(true)
  })

  it("STILL rejects the untouched grid for a normal order", () => {
    // The relaxation must not reintroduce the #1671 silent no-op for ordinary
    // procurement — there, nothing picked is a mistake, not an intent.
    const parsed = inventoryOrderFormSchema.safeParse({
      ...blankGrid,
      is_sample: false,
    })
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(JSON.stringify(parsed.error.issues)).toMatch(/Pick at least one item/)
    }
  })

  it("still validates any row the buyer DID fill in on a sample", () => {
    // Empty is fine; half-finished is not.
    const parsed = inventoryOrderFormSchema.safeParse({
      ...blankGrid,
      order_lines: [{ inventory_item_id: "iitem_1", quantity: 0, price: 0 }],
    })
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(JSON.stringify(parsed.error.issues)).toMatch(/Quantity must be at least 1/)
    }
  })
})
