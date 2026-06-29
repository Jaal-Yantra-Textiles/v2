import { inventoryOrderOwnedByPartner } from "../helpers"

describe("inventoryOrderOwnedByPartner (#778 C1)", () => {
  it("is true only when the order's linked partner id matches the acting partner", () => {
    expect(inventoryOrderOwnedByPartner({ id: "pa_1" }, "pa_1")).toBe(true)
  })

  it("is false when the partners differ (the IDOR case)", () => {
    expect(inventoryOrderOwnedByPartner({ id: "pa_1" }, "pa_2")).toBe(false)
  })

  it("is false when the order has no linked partner", () => {
    expect(inventoryOrderOwnedByPartner(null, "pa_1")).toBe(false)
    expect(inventoryOrderOwnedByPartner(undefined, "pa_1")).toBe(false)
    expect(inventoryOrderOwnedByPartner({}, "pa_1")).toBe(false)
  })

  it("is false when there is no acting partner id", () => {
    expect(inventoryOrderOwnedByPartner({ id: "pa_1" }, null)).toBe(false)
    expect(inventoryOrderOwnedByPartner({ id: "pa_1" }, undefined)).toBe(false)
    expect(inventoryOrderOwnedByPartner({ id: "pa_1" }, "")).toBe(false)
  })
})
