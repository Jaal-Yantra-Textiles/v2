import { describe, expect, it } from "vitest"

import { countryName, craftsOf, energyLines, roleLine, sinceLine } from "../lib"

describe("partner page wording (#2444)", () => {
  it("counts roles in plain words", () => {
    expect(roleLine("Weaver", 3)).toBe("3 weavers")
    expect(roleLine("Dyer", 1)).toBe("1 dyer")
    expect(roleLine("Stitch", 2)).toBe("2 stitches")
  })

  it("names crafts once each, from actions then techniques", () => {
    expect(
      craftsOf({
        capabilities: [
          { id: "a", title: "x", technique: "Handloom", material: null, product_type: null, actions: ["weave"], images: [] },
          { id: "b", title: "y", technique: "handloom", material: null, product_type: null, actions: ["weave", "dye"], images: [] },
        ],
      })
    ).toEqual(["Weaving", "Handloom", "Dyeing"])
  })

  it("says nothing about energy that was not measured, and drops zeros", () => {
    expect(energyLines(null)).toEqual([])
    expect(energyLines({ electricity_kwh: 12.5, water_liters: 0, gas_cubic_meters: 0 })).toEqual([
      "12.5 kWh of electricity",
    ])
  })

  it("dates and places", () => {
    expect(sinceLine("2026-06-05T00:00:00Z")).toBe("Making with us since June 2026")
    expect(sinceLine(null)).toBeNull()
    expect(countryName("IN")).toBe("India")
    expect(countryName(null)).toBeNull()
  })
})
