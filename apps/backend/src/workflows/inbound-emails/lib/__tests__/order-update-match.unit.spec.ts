import {
  buildUpdateSummary,
  matchOrdersByNumber,
  normalizeOrderNumber,
} from "../order-update-match"

describe("normalizeOrderNumber", () => {
  it("strips # and whitespace, upper-cases", () => {
    expect(normalizeOrderNumber(" #jh27228 ")).toBe("JH27228")
    expect(normalizeOrderNumber(27228)).toBe("27228")
  })
  it("returns null for blank or non-string", () => {
    expect(normalizeOrderNumber("  ")).toBeNull()
    expect(normalizeOrderNumber("#")).toBeNull()
    expect(normalizeOrderNumber(null)).toBeNull()
    expect(normalizeOrderNumber({})).toBeNull()
  })
})

describe("matchOrdersByNumber", () => {
  const orders = [
    { id: "a", metadata: { supplier_order_number: "JH27228" } },
    { id: "b", metadata: { order_number: "#SMD1520" } },
    { id: "c", metadata: null },
    { id: "d", metadata: { supplier_order_number: "JH27229" } },
  ]
  it("matches supplier_order_number (the inbound-email create path)", () => {
    expect(matchOrdersByNumber(orders, "JH27228").map((o) => o.id)).toEqual(["a"])
  })
  it("matches the older order_number key too", () => {
    expect(matchOrdersByNumber(orders, "SMD1520").map((o) => o.id)).toEqual(["b"])
  })
  it("is exact: JH2722 matches nothing", () => {
    expect(matchOrdersByNumber(orders, "JH2722")).toEqual([])
  })
  it("no number → no match, never everything", () => {
    expect(matchOrdersByNumber(orders, null)).toEqual([])
  })
})

describe("buildUpdateSummary", () => {
  it("leads with the update, then carrier/tracking and ETA", () => {
    expect(
      buildUpdateSummary(
        {
          update_type: "Shipped",
          carrier: "Delhivery",
          tracking_number: "1504877063931",
          expected_delivery_date: "2026-10-12",
        },
        "Your order JH27228 is on its way"
      )
    ).toBe("Shipped: Delhivery 1504877063931 · ETA 2026-10-12 (Your order JH27228 is on its way)")
  })
  it("falls back to the subject when nothing was extracted", () => {
    expect(buildUpdateSummary({}, "Order JH27228 update")).toBe(
      "Supplier email (Order JH27228 update)"
    )
  })
})
