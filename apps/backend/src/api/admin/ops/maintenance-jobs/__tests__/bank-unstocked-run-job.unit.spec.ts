jest.mock("../../../../../workflows/production-runs/lib/run-output-variants", () => ({
  bankStockLines: jest.fn(),
  resolveRunStockTarget: jest.fn(),
}))
jest.mock("../../../../../workflows/production-runs/lib/partner-location", () => ({
  resolvePartnerLocation: jest.fn(),
}))
jest.mock("../../../../../workflows/production-runs/lib/run-variant", () => ({
  resolveRunVariant: jest.fn(),
}))

import { parseOutputParam } from "../bank-unstocked-run-job"

describe("bank-unstocked-run produced_output param (#2271)", () => {
  it("parses S:1,M:2", () => {
    expect(parseOutputParam("S:1, M:2")).toEqual([
      { size_label: "S", color: null, quantity: 1 },
      { size_label: "M", color: null, quantity: 2 },
    ])
  })

  it("parses a colour after a slash", () => {
    expect(parseOutputParam("S/Indigo:1")).toEqual([
      { size_label: "S", color: "Indigo", quantity: 1 },
    ])
  })

  it("refuses a part with no quantity", () => {
    expect(() => parseOutputParam("S")).toThrow(/SIZE:QTY/)
  })
})
