import { describe, it, expect } from "vitest"
import type { ProductionStory } from "@lib/data/designs"
import { craftedBy, looksLikeEmail } from "../lib"

const story = (over: Partial<ProductionStory>): ProductionStory => ({
  design_id: "d1",
  runs: [],
  consumption: {
    energy: { electricity_kwh: 0, water_liters: 0, gas_cubic_meters: 0 },
    labor_hours: 0,
    materials_consumed: [],
    total_logs: 0,
  },
  people: [],
  partners: [],
  materials: [],
  ...over,
})

const fabric = (id: string, name: string, supplier: string | null = null) => ({
  id,
  name,
  composition: null,
  color: null,
  media: null,
  material_type: null,
  supplier: supplier ? { id: `p_${supplier}`, name: supplier } : null,
})

describe("craftedBy (#2442)", () => {
  it("names each fabric's supplier and each maker's stage", () => {
    const out = craftedBy(
      story({
        materials: [fabric("rm1", "Organic Kala Cotton", "HR Handloom"), fabric("rm2", "Matka Silk")],
        partners: [{ id: "p1", name: "Sharlho", stage_role: "stitching" }],
      })
    )
    expect(out.fabrics).toEqual([
      { id: "rm1", name: "Organic Kala Cotton", supplier: "HR Handloom" },
      { id: "rm2", name: "Matka Silk", supplier: null },
    ])
    expect(out.makers).toEqual([{ id: "p1", verb: "Stitched by", name: "Sharlho" }])
  })

  it("lends a roster supplier to fabrics no order named, and does not list them twice", () => {
    const out = craftedBy(
      story({
        materials: [fabric("rm1", "Handloom Denim")],
        partners: [
          { id: "p_mill", name: "JP Handloom", stage_role: "supplier" },
          { id: "p_t", name: "Prince Tailors", stage_role: null },
        ],
      })
    )
    expect(out.fabrics[0].supplier).toBe("JP Handloom")
    expect(out.makers).toEqual([{ id: "p_t", verb: "Made by", name: "Prince Tailors" }])
  })

  it("lists a fabric once when two records share its name", () => {
    const out = craftedBy(
      story({ materials: [fabric("rm1", "60lea Linen"), fabric("rm2", "60lea Linen"), fabric("rm3", "Silk")] })
    )
    expect(out.fabrics.map((f) => f.name)).toEqual(["60lea Linen", "Silk"])
  })

  it("skips the photoshoot and falls back to the design's partners on an older backend", () => {
    expect(
      craftedBy(story({ partners: [{ id: "p", name: "Studio", stage_role: "photoshoot" }] })).makers
    ).toEqual([])
    expect(craftedBy(null, [{ id: "p1", name: "Sharlho" }]).makers).toEqual([
      { id: "p1", verb: "Made by", name: "Sharlho" },
    ])
  })
})

describe("looksLikeEmail", () => {
  it("accepts an address and refuses the rest", () => {
    expect(looksLikeEmail(" a@b.co ")).toBe(true)
    expect(looksLikeEmail("")).toBe(false)
    expect(looksLikeEmail("a@b")).toBe(false)
    expect(looksLikeEmail("a b@c.d")).toBe(false)
  })
})
