import {
  summarizeConsumption,
  buildProductionStory,
} from "../build-story"

describe("summarizeConsumption", () => {
  it("buckets energy / labor / materials and omits money", () => {
    const summary = summarizeConsumption(
      [
        { consumption_type: "energy_electricity", quantity: 12, unit_of_measure: "kWh" },
        { consumption_type: "energy_electricity", quantity: 8, unit_of_measure: "kWh" },
        { consumption_type: "energy_water", quantity: 50, unit_of_measure: "Liter" },
        { consumption_type: "energy_gas", quantity: 3, unit_of_measure: "Cubic_Meter" },
        { consumption_type: "labor", quantity: 4.5, unit_of_measure: "Hour" },
        { consumption_type: "labor", quantity: 1.5, unit_of_measure: "Hour" },
        { consumption_type: "production", quantity: 2, unit_of_measure: "Meter", raw_material_id: "rm_1" },
        { consumption_type: "sample", quantity: 1, unit_of_measure: "Meter", raw_material_id: "rm_1" },
        { consumption_type: "wastage", quantity: 0.5, unit_of_measure: "Kilogram", raw_material_id: "rm_2" },
      ],
      { rm_1: "Cotton", rm_2: "Polyester" }
    )

    expect(summary.energy.electricity_kwh).toBe(20)
    expect(summary.energy.water_liters).toBe(50)
    expect(summary.energy.gas_cubic_meters).toBe(3)
    expect(summary.labor_hours).toBe(6)
    expect(summary.total_logs).toBe(9)

    // rm_1 Meter (2 + 1) grouped; rm_2 Kilogram separate
    const cotton = summary.materials_consumed.find((m) => m.raw_material_id === "rm_1")
    expect(cotton?.quantity).toBe(3)
    expect(cotton?.name).toBe("Cotton")
    expect(cotton?.unit_of_measure).toBe("Meter")
    const poly = summary.materials_consumed.find((m) => m.raw_material_id === "rm_2")
    expect(poly?.quantity).toBe(0.5)

    // no money fields leak
    expect(JSON.stringify(summary)).not.toContain("unit_cost")
    expect(JSON.stringify(summary)).not.toContain("cost")
  })

  it("returns a clean empty summary for no logs", () => {
    const s = summarizeConsumption([])
    expect(s.energy).toEqual({ electricity_kwh: 0, water_liters: 0, gas_cubic_meters: 0 })
    expect(s.labor_hours).toBe(0)
    expect(s.materials_consumed).toEqual([])
    expect(s.total_logs).toBe(0)
  })
})

describe("buildProductionStory", () => {
  it("assembles runs, people, partners, materials", () => {
    const story = buildProductionStory({
      designId: "design_1",
      runs: [
        {
          id: "run_1",
          status: "completed",
          run_type: "production",
          quantity: 10,
          produced_quantity: 9,
          rejected_quantity: 1,
          started_at: new Date("2026-01-01T00:00:00Z"),
          finished_at: null,
          completed_at: new Date("2026-01-05T00:00:00Z"),
          created_at: new Date("2025-12-30T00:00:00Z"),
          partner_cost_estimate: 999, // must NOT appear in output
        },
      ],
      activitiesByRun: {
        run_1: [
          { id: "act_1", activity_type: "lifecycle_event", kind: "completed", summary: "done", created_at: new Date("2026-01-05T00:00:00Z") },
        ],
      },
      logs: [
        { consumption_type: "energy_electricity", quantity: 5, unit_of_measure: "kWh" },
      ],
      personLinks: [
        { role: "tailor", person: { id: "per_1", first_name: "Asha", last_name: "K" } },
        { role: null, person: { id: "per_2", first_name: "Ravi", last_name: "" } },
      ],
      partners: [{ id: "partner_1", name: "Stitch Co" }],
      inventoryItems: [
        {
          id: "inv_1",
          raw_materials: [
            { id: "rm_1", name: "Cotton", composition: "100% Cotton", color: "white", media: { url: "x.jpg" }, material_type: { id: "mt_1", name: "Fabric" } },
          ],
        },
      ],
    })

    expect(story.design_id).toBe("design_1")
    expect(story.runs).toHaveLength(1)
    expect(story.runs[0].status).toBe("completed")
    expect(story.runs[0].started_at).toBe("2026-01-01T00:00:00.000Z")
    expect(story.runs[0].activity).toHaveLength(1)
    expect(story.people).toEqual([
      { id: "per_1", name: "Asha K", role: "tailor" },
      { id: "per_2", name: "Ravi", role: null },
    ])
    expect(story.partners).toEqual([{ id: "partner_1", name: "Stitch Co" }])
    expect(story.materials[0]).toMatchObject({ id: "rm_1", name: "Cotton", material_type: "Fabric", media: { url: "x.jpg" } })
    expect(story.consumption.energy.electricity_kwh).toBe(5)

    // money omitted
    expect(JSON.stringify(story)).not.toContain("999")
    expect(JSON.stringify(story)).not.toContain("partner_cost_estimate")
  })

  it("returns an empty-but-clean story when the design has nothing", () => {
    const story = buildProductionStory({
      designId: "design_empty",
      runs: [],
      activitiesByRun: {},
      logs: [],
      personLinks: [],
      partners: [],
      inventoryItems: [],
    })
    expect(story.runs).toEqual([])
    expect(story.people).toEqual([])
    expect(story.partners).toEqual([])
    expect(story.materials).toEqual([])
    expect(story.consumption.total_logs).toBe(0)
  })
})
