import {
  toReceiptLineView,
  initialFormState,
  validateReceipt,
  buildReceiptPayload,
  isPlainFullReceipt,
  canReceiveFrom,
  sumPortions,
  type ReceiptLineView,
} from "../receipt-helpers"

/**
 * The receipt form's arithmetic (#2144).
 *
 * The dated case: the GOF order — 86 m of cloth, ₹69,340 — lands at a partner's
 * bench. She keeps what she will cut; the balance goes to our Main Warehouse.
 * One delivery, two destinations, and before this the only way to say it was
 * two receipts, the second claiming against an order the first had closed.
 */
describe("receipt helpers", () => {
  const KSAMAN = "sloc_ksaman"
  const WAREHOUSE = "sloc_main_warehouse"

  const view = (over: Partial<ReceiptLineView> = {}): ReceiptLineView => ({
    id: "line_cloth",
    label: "GOF Cotton",
    ordered: 86,
    received: 0,
    outstanding: 86,
    inventory_item_id: "iitem_cloth",
    ...over,
  })

  describe("toReceiptLineView", () => {
    it("sums line_fulfillments into what has ALREADY been received", () => {
      const v = toReceiptLineView({
        id: "line_1",
        quantity: 86,
        material_name: "GOF Cotton",
        line_fulfillments: [{ quantity_delta: 60 }, { quantity_delta: 6 }],
      })
      expect(v.received).toBe(66)
      expect(v.outstanding).toBe(20)
    })

    it("🔴 never shows a negative outstanding on an over-received line", () => {
      const v = toReceiptLineView({
        id: "line_1",
        quantity: 10,
        line_fulfillments: [{ quantity_delta: 12 }],
      })
      expect(v.outstanding).toBe(0)
    })

    it("treats a line with no fulfillments as nothing received", () => {
      expect(toReceiptLineView({ id: "l", quantity: 5 }).received).toBe(0)
    })

    it("keeps decimal metres free of float noise", () => {
      const v = toReceiptLineView({
        id: "l",
        quantity: 4.5,
        line_fulfillments: [{ quantity_delta: 1.1 }, { quantity_delta: 2.2 }],
      })
      expect(v.received).toBe(3.3)
      expect(v.outstanding).toBe(1.2)
    })

    it("names the line by its product, not a bare variant title", () => {
      // #1662 — "M" on its own tells an operator nothing.
      const v = toReceiptLineView({
        id: "l",
        quantity: 1,
        inventory_items: [
          { id: "ii", title: "M", variants: [{ title: "M", product: { title: "Pashmina Shawl" } }] },
        ],
      })
      expect(v.label).toBe("Pashmina Shawl · M")
    })
  })

  describe("initialFormState", () => {
    it("opens on everything outstanding, at the order's own destination", () => {
      const state = initialFormState([view()])
      expect(state["line_cloth"]).toEqual([
        { key: "line_cloth-0", quantity: "86", stock_location_id: "" },
      ])
    })

    it("leaves a fully-received line blank rather than offering a 0", () => {
      const state = initialFormState([view({ received: 86, outstanding: 0 })])
      expect(state["line_cloth"][0].quantity).toBe("")
    })
  })

  describe("validateReceipt", () => {
    const split = (a: number, b: number) => ({
      line_cloth: [
        { key: "a", quantity: String(a), stock_location_id: KSAMAN },
        { key: "b", quantity: String(b), stock_location_id: WAREHOUSE },
      ],
    })

    it("accepts a split that adds up to what is outstanding", () => {
      const r = validateReceipt([view()], split(60, 26))
      expect(r.canSubmit).toBe(true)
      expect(r.lineErrors).toEqual({})
    })

    it("🔴 catches an over-receipt ACROSS the split, not per portion", () => {
      // 50 and 50 each look fine against 86 on their own.
      const r = validateReceipt([view()], split(50, 50))
      expect(r.canSubmit).toBe(false)
      expect(r.lineErrors["line_cloth"]).toMatch(/100 claimed but only 86 outstanding/)
      expect(r.lineErrors["line_cloth"]).toMatch(/across the split/)
    })

    it("measures against what is OUTSTANDING, not what was ordered", () => {
      const r = validateReceipt([view({ received: 80, outstanding: 6 })], split(6, 6))
      expect(r.canSubmit).toBe(false)
      expect(r.lineErrors["line_cloth"]).toMatch(/12 claimed but only 6 outstanding/)
    })

    it("tolerates decimal rounding rather than calling 4.5 an over-receipt", () => {
      const r = validateReceipt([view({ ordered: 4.5, outstanding: 4.5 })], {
        line_cloth: [{ key: "a", quantity: "4.5", stock_location_id: "" }],
      })
      expect(r.canSubmit).toBe(true)
    })

    it("refuses a negative quantity", () => {
      const r = validateReceipt([view()], {
        line_cloth: [{ key: "a", quantity: "-2", stock_location_id: "" }],
      })
      expect(r.lineErrors["line_cloth"]).toMatch(/cannot be negative/)
      expect(r.canSubmit).toBe(false)
    })

    it("refuses text typed into a quantity", () => {
      const r = validateReceipt([view()], {
        line_cloth: [{ key: "a", quantity: "sixty", stock_location_id: "" }],
      })
      expect(r.canSubmit).toBe(false)
    })

    it("🔴 cannot submit an empty receipt — a no-op write is not a receipt", () => {
      const r = validateReceipt([view()], {
        line_cloth: [{ key: "a", quantity: "", stock_location_id: "" }],
      })
      expect(r.hasAnything).toBe(false)
      expect(r.canSubmit).toBe(false)
    })
  })

  describe("buildReceiptPayload", () => {
    it("🔴 emits the SAME line twice when it is split across locations", () => {
      const payload = buildReceiptPayload([view()], {
        line_cloth: [
          { key: "a", quantity: "60", stock_location_id: KSAMAN },
          { key: "b", quantity: "26", stock_location_id: WAREHOUSE },
        ],
      })
      expect(payload).toEqual([
        { order_line_id: "line_cloth", quantity: 60, stock_location_id: KSAMAN },
        { order_line_id: "line_cloth", quantity: 26, stock_location_id: WAREHOUSE },
      ])
    })

    it("omits stock_location_id entirely when the portion names none", () => {
      const payload = buildReceiptPayload([view()], {
        line_cloth: [{ key: "a", quantity: "86", stock_location_id: "" }],
      })
      // NOT `stock_location_id: undefined` — the server resolves the
      // destination, and the screen must not bake in what it happened to show.
      expect(payload).toEqual([{ order_line_id: "line_cloth", quantity: 86 }])
      expect("stock_location_id" in payload[0]).toBe(false)
    })

    it("drops blank and zero portions instead of sending them", () => {
      const payload = buildReceiptPayload([view()], {
        line_cloth: [
          { key: "a", quantity: "60", stock_location_id: "" },
          { key: "b", quantity: "", stock_location_id: WAREHOUSE },
          { key: "c", quantity: "0", stock_location_id: WAREHOUSE },
        ],
      })
      expect(payload).toEqual([{ order_line_id: "line_cloth", quantity: 60 }])
    })
  })

  describe("isPlainFullReceipt", () => {
    it("recognises receive-everything so the request can omit lines entirely", () => {
      const lines = [view()]
      const payload = buildReceiptPayload(lines, initialFormState(lines))
      expect(isPlainFullReceipt(lines, payload)).toBe(true)
    })

    it("🔴 a split is NOT a plain full receipt, even when the totals match", () => {
      const lines = [view()]
      const payload = buildReceiptPayload(lines, {
        line_cloth: [
          { key: "a", quantity: "60", stock_location_id: KSAMAN },
          { key: "b", quantity: "26", stock_location_id: WAREHOUSE },
        ],
      })
      expect(isPlainFullReceipt(lines, payload)).toBe(false)
    })

    it("a short receipt is not a plain full receipt", () => {
      const lines = [view()]
      const payload = buildReceiptPayload(lines, {
        line_cloth: [{ key: "a", quantity: "60", stock_location_id: "" }],
      })
      expect(isPlainFullReceipt(lines, payload)).toBe(false)
    })

    it("ignores lines that have nothing left outstanding", () => {
      const lines = [view(), view({ id: "line_done", received: 5, ordered: 5, outstanding: 0 })]
      const payload = buildReceiptPayload(lines, initialFormState(lines))
      expect(isPlainFullReceipt(lines, payload)).toBe(true)
    })
  })

  describe("canReceiveFrom", () => {
    it("🔴 allows Delivered — the carrier status the old door REFUSED", () => {
      expect(canReceiveFrom("Delivered")).toBe(true)
    })

    it("refuses Pending, because nothing has left the supplier", () => {
      expect(canReceiveFrom("Pending")).toBe(false)
    })

    it("refuses a cancelled order and an unknown status", () => {
      expect(canReceiveFrom("Cancelled")).toBe(false)
      expect(canReceiveFrom(null)).toBe(false)
    })
  })

  describe("sumPortions", () => {
    it("keeps a split of decimal metres free of float noise", () => {
      expect(
        sumPortions([
          { key: "a", quantity: "1.1", stock_location_id: "" },
          { key: "b", quantity: "2.2", stock_location_id: "" },
        ])
      ).toBe(3.3)
    })
  })
})
