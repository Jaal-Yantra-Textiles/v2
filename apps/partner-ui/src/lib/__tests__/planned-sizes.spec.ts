import { describe, expect, it } from "vitest"

import { formatPlannedOutput } from "../planned-sizes"

describe("formatPlannedOutput (#2500)", () => {
  it("reads a size-only plan, as a bundle stores it", () => {
    expect(
      formatPlannedOutput([
        { size_label: "38", quantity: 1 },
        { size_label: "40", quantity: 1 },
      ])
    ).toBe("38×1, 40×1")
  })

  it("names the colour when a line has one", () => {
    expect(
      formatPlannedOutput([
        { size_label: "M", color: "Black", quantity: 2 },
        { size_label: "L", color: "Black", quantity: 1 },
      ])
    ).toBe("M Black×2, L Black×1")
  })

  it("shows nothing when there is no plan, or the plan is only the quantity", () => {
    expect(formatPlannedOutput(null)).toBeNull()
    expect(formatPlannedOutput(undefined)).toBeNull()
    expect(formatPlannedOutput([])).toBeNull()
    expect(formatPlannedOutput([{ quantity: 3 }])).toBeNull()
  })

  it("drops empty lines", () => {
    expect(
      formatPlannedOutput([
        { size_label: "Custom Bag", quantity: 10 },
        { size_label: "M", quantity: 0 },
      ])
    ).toBe("Custom Bag×10")
  })
})
