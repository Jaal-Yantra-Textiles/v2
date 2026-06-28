import { detectRegion } from "../registry"

const regions = {
  regions: [
    {
      id: "reg_in",
      name: "India",
      currency_code: "inr",
      countries: [{ iso_2: "in" }],
    },
    {
      id: "reg_eu",
      name: "Europe",
      currency_code: "eur",
      countries: [{ iso_2: "de" }, { iso_2: "FR" }],
    },
  ],
}

describe("detectRegion", () => {
  it("matches a country to its region (case-insensitive)", () => {
    const out = detectRegion(regions, "IN")
    expect(out.match?.id).toBe("reg_in")
    expect(out.match?.currency_code).toBe("inr")
    expect(out.match?.countries).toEqual(["in"])
  })

  it("matches a region whose country is stored upper-case", () => {
    expect(detectRegion(regions, "fr").match?.id).toBe("reg_eu")
  })

  it("returns null match but still lists all regions when no country matches", () => {
    const out = detectRegion(regions, "jp")
    expect(out.match).toBeNull()
    expect(out.regions.map((r) => r.id)).toEqual(["reg_in", "reg_eu"])
  })

  it("returns null match for an empty country code", () => {
    expect(detectRegion(regions, "").match).toBeNull()
  })

  it("is robust to a missing/empty payload", () => {
    expect(detectRegion(undefined, "in")).toEqual({ match: null, regions: [] })
    expect(detectRegion({ regions: null }, "in").regions).toEqual([])
  })

  it("drops non-string country isos when slimming", () => {
    const data = { regions: [{ id: "r", name: "n", currency_code: "usd", countries: [{ iso_2: "us" }, { iso_2: null }] }] }
    expect(detectRegion(data, "us").match?.countries).toEqual(["us"])
  })
})
