import { assertDeletable, isDeletableStatus } from "../lib/delete-helpers"

describe("isDeletableStatus / assertDeletable (#778 H11)", () => {
  it("allows deleting orders with no posted stock / fulfillment", () => {
    for (const s of ["Pending", "Processing", "Cancelled"]) {
      expect(isDeletableStatus(s)).toBe(true)
      expect(() => assertDeletable(s)).not.toThrow()
    }
  })

  it("blocks deleting orders that posted stock or have active fulfillments", () => {
    for (const s of ["Shipped", "Delivered", "Partial"]) {
      expect(isDeletableStatus(s)).toBe(false)
      expect(() => assertDeletable(s)).toThrow(/cancel it first/i)
    }
  })

  it("treats missing status as deletable (legacy rows)", () => {
    expect(isDeletableStatus(null)).toBe(true)
    expect(isDeletableStatus(undefined)).toBe(true)
    expect(() => assertDeletable(null)).not.toThrow()
  })
})
