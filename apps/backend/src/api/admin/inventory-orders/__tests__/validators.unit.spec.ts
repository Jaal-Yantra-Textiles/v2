import {
  createInventoryOrdersSchema,
  updateInventoryOrdersSchema,
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
