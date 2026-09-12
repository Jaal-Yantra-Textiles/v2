import {
  createInventoryOrdersSchema,
  updateInventoryOrdersSchema,
  updateOrderLineSchema,
} from "../validators"

describe("inventory-order validators", () => {
  describe("updateInventoryOrdersSchema — is_sample default must not survive .partial()", () => {
    it("does NOT inject is_sample on a status-only update", () => {
      // Regression: `.optional().default(false)` survives `.partial()` in Zod v4,
      // so an omitted is_sample used to inject `false` and silently flip a sample
      // order to a non-sample one (the route spreads ...validatedBody into update).
      const parsed = updateInventoryOrdersSchema.parse({ status: "Shipped" })
      expect(parsed.is_sample).toBeUndefined()
      expect("is_sample" in parsed).toBe(false)
      expect(parsed.status).toBe("Shipped")
    })

    it("preserves an explicit is_sample=true", () => {
      const parsed = updateInventoryOrdersSchema.parse({ is_sample: true })
      expect(parsed.is_sample).toBe(true)
    })

    it("preserves an explicit is_sample=false", () => {
      const parsed = updateInventoryOrdersSchema.parse({ is_sample: false })
      expect(parsed.is_sample).toBe(false)
    })
  })

  describe("createInventoryOrdersSchema — default stays intact on create", () => {
    it("still defaults is_sample to false when omitted on create", () => {
      const parsed = createInventoryOrdersSchema.parse({
        order_lines: [
          { inventory_item_id: "ii_1", quantity: 1, price: 1 },
        ],
        quantity: 1,
        total_price: 1,
        status: "Pending",
        expected_delivery_date: "2026-06-20T00:00:00.000Z",
        order_date: "2026-06-18T00:00:00.000Z",
        shipping_address: {},
        stock_location_id: "sloc_1",
      })
      expect(parsed.is_sample).toBe(false)
    })
  })
})

/**
 * Samples/swatch orders. A sample is ordered precisely because nobody knows
 * what will arrive, so it must be creatable with NO lines and filled in later.
 */
describe("createInventoryOrdersSchema — a sample may start with no lines", () => {
  const base = {
    quantity: 0,
    total_price: 0,
    status: "Pending" as const,
    expected_delivery_date: "2026-10-01T00:00:00.000Z",
    order_date: "2026-09-12T00:00:00.000Z",
    shipping_address: {},
    stock_location_id: "sloc_1",
  }

  it("accepts a sample order with no order_lines at all", () => {
    const parsed = createInventoryOrdersSchema.safeParse({
      ...base,
      is_sample: true,
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.order_lines).toEqual([])
  })

  it("accepts a sample order with an explicitly empty array", () => {
    expect(
      createInventoryOrdersSchema.safeParse({
        ...base,
        is_sample: true,
        order_lines: [],
      }).success
    ).toBe(true)
  })

  it("STILL rejects a non-sample order with no lines", () => {
    // The relaxation must not leak into ordinary procurement.
    const parsed = createInventoryOrdersSchema.safeParse({
      ...base,
      quantity: 5,
      is_sample: false,
      order_lines: [],
    })
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(JSON.stringify(parsed.error.issues)).toMatch(/only a sample order/)
    }
  })

  it("rejects a non-sample order that omits order_lines entirely", () => {
    expect(
      createInventoryOrdersSchema.safeParse({ ...base, quantity: 5 }).success
    ).toBe(false)
  })
})

describe("updateOrderLineSchema — naming a material that does not exist yet", () => {
  it("accepts a line with new_material and no item or variant", () => {
    const parsed = updateOrderLineSchema.safeParse({
      new_material: { name: "Tangaliya Weave", color: "Indigo" },
      quantity: 1,
      price: 0,
    })
    expect(parsed.success).toBe(true)
  })

  it("rejects new_material alongside an existing item", () => {
    // It would create a duplicate of the item that was picked.
    const parsed = updateOrderLineSchema.safeParse({
      inventory_item_id: "iitem_1",
      new_material: { name: "Tangaliya Weave" },
      quantity: 1,
      price: 0,
    })
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(JSON.stringify(parsed.error.issues)).toMatch(/duplicate/)
    }
  })

  it("rejects a nameless new_material", () => {
    expect(
      updateOrderLineSchema.safeParse({
        new_material: { name: "" },
        quantity: 1,
        price: 0,
      }).success
    ).toBe(false)
  })

  it("still rejects a line that points at nothing at all", () => {
    const parsed = updateOrderLineSchema.safeParse({ quantity: 1, price: 0 })
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(JSON.stringify(parsed.error.issues)).toMatch(/new_material/)
    }
  })
})
