import { describe, expect, it } from "vitest"
import { lineTotal, lineUnitPrice } from "./line-money"

/**
 * The six lines of inv_order_01M1ZH7Y50W37WMGXYP2DM1KAF (GOF Asia, 73 m) with
 * the ₹120/m dye charge. The order's own total_price is 65,800 — computing
 * these rows from `price` alone yields 57,770, the gap the partner UI showed.
 */
const GOF_LINES = [
  { price: 255, extra_cost: 120, quantity: 12 },
  { price: 285, extra_cost: 120, quantity: 12 },
  { price: 1460, extra_cost: 120, quantity: 11 },
  { price: 690, extra_cost: 120, quantity: 13 },
  { price: 1230, extra_cost: 120, quantity: 13 },
  { price: 795, extra_cost: 120, quantity: 12 },
]

describe("inventory order line money (#1894)", () => {
  it("folds extra_cost into the per-unit price", () => {
    expect(lineUnitPrice({ price: 255, extra_cost: 120 })).toBe(375)
  })

  it("makes the rows sum to the order total shown beneath them", () => {
    const sum = GOF_LINES.reduce((acc, l) => acc + lineTotal(l, l.quantity), 0)
    expect(sum).toBe(65800)
    // and is not the price-only figure the UI used to render. 57,040 is what
    // this same fixture yields when extra_cost is dropped — asserting against
    // it is what makes this test fail on the old code.
    expect(sum).not.toBe(57040)
  })

  it("treats a null or absent extra_cost as no extra charge", () => {
    expect(lineUnitPrice({ price: 690, extra_cost: null })).toBe(690)
    expect(lineUnitPrice({ price: 690 })).toBe(690)
  })

  it("survives a missing line rather than rendering NaN", () => {
    expect(lineUnitPrice(null)).toBe(0)
    expect(lineTotal(undefined, 12)).toBe(0)
  })
})
