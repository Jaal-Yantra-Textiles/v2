import { pickInventoryOrderDestinations } from "../order-destination"

describe("pickInventoryOrderDestinations (#2286)", () => {
  it("takes the to_location row, whichever order the rows come back in", () => {
    const from = { inventory_orders_id: "io1", stock_location_id: "gof", from_location: true, to_location: false }
    const to = { inventory_orders_id: "io1", stock_location_id: "ksaman", from_location: false, to_location: true }
    expect(pickInventoryOrderDestinations([from, to]).get("io1")).toBe("ksaman")
    // The bug this replaces: `[0]` picked the source when it came back first.
    expect(pickInventoryOrderDestinations([to, from]).get("io1")).toBe("ksaman")
  })

  it("a legacy one-ended order with no flags: its only row is the destination", () => {
    const rows = [{ inventory_orders_id: "io2", stock_location_id: "dharamshala" }]
    expect(pickInventoryOrderDestinations(rows).get("io2")).toBe("dharamshala")
  })

  it("a source alone is never a destination", () => {
    const rows = [{ inventory_orders_id: "io3", stock_location_id: "gof", from_location: true }]
    expect(pickInventoryOrderDestinations(rows).get("io3")).toBeNull()
  })

  it("two unflagged rows are ambiguous: null, not a guess", () => {
    const rows = [
      { inventory_orders_id: "io4", stock_location_id: "a" },
      { inventory_orders_id: "io4", stock_location_id: "b" },
    ]
    expect(pickInventoryOrderDestinations(rows).get("io4")).toBeNull()
  })

  it("answers per order", () => {
    const rows = [
      { inventory_orders_id: "x", stock_location_id: "p", to_location: true },
      { inventory_orders_id: "y", stock_location_id: "q", to_location: true },
    ]
    const out = pickInventoryOrderDestinations(rows)
    expect(out.get("x")).toBe("p")
    expect(out.get("y")).toBe("q")
  })
})
