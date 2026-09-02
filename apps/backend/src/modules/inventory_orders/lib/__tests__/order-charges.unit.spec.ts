import {
  foldOrderCharges,
  orderPayableCeiling,
} from "../order-charges"

/**
 * #1737 — the three real amounts that had no home, and the rule that keeps the
 * write guard and the offer screen agreeing to the paisa.
 */
describe("foldOrderCharges", () => {
  it("separates what raises the obligation from what lowers it", () => {
    expect(
      foldOrderCharges([
        { type: "tax", amount: 200 },
        { type: "shipping", amount: 1960 },
        { type: "discount", amount: 829 },
      ])
    ).toEqual({ raises: 2160, lowers: 829, net: 1331 })
  })

  /**
   * 🔑 The sign lives on the TYPE, not on the number. A tax of 200 and a
   * discount of 200 are the same figure and opposite facts.
   */
  it("reads the same amount in opposite directions by type", () => {
    expect(foldOrderCharges([{ type: "tax", amount: 200 }]).net).toBe(200)
    expect(foldOrderCharges([{ type: "discount", amount: 200 }]).net).toBe(-200)
  })

  /**
   * ⚠️ A negative that slipped into the column must not flip its own type's
   * direction — a `tax` of -200 quietly reducing what we owe is the shape that
   * underpays a partner and looks like arithmetic.
   */
  it("refuses to let a negative amount invert its type", () => {
    expect(foldOrderCharges([{ type: "tax", amount: -200 }]).net).toBe(200)
    expect(foldOrderCharges([{ type: "discount", amount: -200 }]).net).toBe(-200)
  })

  /**
   * ⚠️ An unknown type counts in NEITHER direction. Guessing it upward would
   * invent an obligation, which is the direction that overpays.
   */
  it("ignores a type it does not understand rather than guessing upward", () => {
    expect(
      foldOrderCharges([
        { type: "tax", amount: 100 },
        { type: "gratuity" as any, amount: 5000 },
      ])
    ).toEqual({ raises: 100, lowers: 0, net: 100 })
  })

  it("treats no charges, null and junk amounts as nothing", () => {
    expect(foldOrderCharges(null).net).toBe(0)
    expect(foldOrderCharges([]).net).toBe(0)
    expect(foldOrderCharges([{ type: "tax", amount: "abc" as any }]).net).toBe(0)
  })
})

describe("orderPayableCeiling", () => {
  /**
   * 🔴 The property that makes this safe behind a live money guard: an order
   * with no charges yields EXACTLY `total_price`, so every existing row on
   * production behaves identically the moment this ships.
   */
  it("is exactly total_price when there are no charges", () => {
    expect(orderPayableCeiling({ total_price: 56856.94 }, [])).toBe(56856.94)
    expect(orderPayableCeiling({ total_price: 56856.94 }, null)).toBe(56856.94)
  })

  /** The Terry Towel order: 4 × 1,000 of goods, 200 of tax. */
  it("raises the ceiling by tax so the invoice total is billable", () => {
    expect(
      orderPayableCeiling({ total_price: 4000 }, [{ type: "tax", amount: 200 }])
    ).toBe(4200)
  })

  /** `inv_order_01K5QSCSK…`: goods, freight on top, and the remainder written off. */
  it("reproduces the Shramdaan order once shipping and the write-off are counted", () => {
    expect(
      orderPayableCeiling({ total_price: 56869 }, [
        { type: "shipping", amount: 1960 },
        { type: "discount", amount: 829 },
      ])
    ).toBe(58000)
  })

  /**
   * ⚠️ Never negative. A write-off larger than the order would otherwise read
   * as "this partner owes us", a claim no data here supports.
   */
  it("floors at zero rather than reporting a partner as owing us", () => {
    expect(
      orderPayableCeiling({ total_price: 1000 }, [
        { type: "discount", amount: 5000 },
      ])
    ).toBe(0)
  })

  it("keeps money to two decimals rather than float dust", () => {
    expect(
      orderPayableCeiling({ total_price: 0.1 }, [{ type: "tax", amount: 0.2 }])
    ).toBe(0.3)
  })
})
