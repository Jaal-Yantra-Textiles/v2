import { financialYearWindow } from "../financial-year"

/**
 * #1216 — the LUT form prefills its validity window from the FY label. That
 * window is what makes an expired LUT stop justifying a zero-IGST declaration, so
 * a wrong end date is a compliance bug rather than a cosmetic one.
 */
describe("financialYearWindow", () => {
  it("maps an Indian FY onto 1 April → 31 March", () => {
    expect(financialYearWindow("2026-27")).toEqual({
      from: "2026-04-01",
      to: "2027-03-31",
    })
  })

  it("tolerates surrounding whitespace", () => {
    expect(financialYearWindow("  2026-27 ")).toEqual({
      from: "2026-04-01",
      to: "2027-03-31",
    })
  })

  it("handles the century rollover", () => {
    // "2099-00" means 2100, not 2000 — naive century-prefixing would go backwards.
    expect(financialYearWindow("2099-00")).toEqual({
      from: "2099-04-01",
      to: "2100-03-31",
    })
  })

  it.each([
    ["empty", ""],
    ["a single year", "2026"],
    ["a full end year", "2026-2027"],
    ["prose", "FY 2026-27"],
    ["nonsense", "abcd-ef"],
  ])("returns null for %s so nothing is prefilled from junk", (_label, input) => {
    expect(financialYearWindow(input)).toBeNull()
  })

  it("returns null rather than throwing on a missing value", () => {
    expect(financialYearWindow(undefined as any)).toBeNull()
    expect(financialYearWindow(null as any)).toBeNull()
  })
})
