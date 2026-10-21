import {
  countRoles,
  publicCapabilities,
  summarizeEnergy,
  summarizeRuns,
} from "../build-profile"

const P = "partner_a"
const NOW = new Date("2026-10-21T00:00:00Z")

describe("summarizeRuns (#2444)", () => {
  it("counts finished pieces once, splits samples, and dates the first", () => {
    const s = summarizeRuns(
      [
        // parent + its child for the same partner: only the child counts
        { id: "parent", partner_id: P, status: "completed", quantity: 9, produced_quantity: 9, completed_at: "2026-06-05T00:00:00Z" },
        { id: "child", partner_id: P, parent_run_id: "parent", status: "completed", quantity: 9, produced_quantity: 9, completed_at: "2026-06-05T00:00:00Z", design_id: "d1" },
        { id: "recent", partner_id: P, status: "completed", run_type: "production", quantity: 2, produced_quantity: null, completed_at: "2026-10-01T00:00:00Z", design_id: "d2" },
        { id: "sample", partner_id: P, status: "completed", run_type: "sample", quantity: 1, produced_quantity: 1, completed_at: "2026-08-13T00:00:00Z" },
        // minted "completed" from a stock fulfilment: no completion date, not made
        { id: "stock", partner_id: P, status: "completed", quantity: 1, produced_quantity: 1, completed_at: null },
        { id: "open", partner_id: P, status: "in_progress", quantity: 5, completed_at: null },
        { id: "theirs", partner_id: "other", status: "completed", quantity: 50, completed_at: "2026-10-01T00:00:00Z" },
      ],
      P,
      NOW
    )
    expect(s.pieces_made).toBe(11)
    expect(s.samples_made).toBe(1)
    expect(s.pieces_last_90_days).toBe(2)
    expect(s.making_since).toBe("2026-06-05T00:00:00.000Z")
    expect(s.run_ids.sort()).toEqual(["child", "recent", "sample"])
    expect(s.design_ids).toEqual(["d1", "d2"])
  })
})

describe("summarizeEnergy (#2444)", () => {
  const runs = [
    { id: "r1", produced_quantity: 4 },
    { id: "r2", produced_quantity: 1 },
  ]

  it("leaves out what the #697 backfill synthesised", () => {
    expect(
      summarizeEnergy(
        [
          { production_run_id: "r1", consumption_type: "energy_electricity", quantity: 30, metadata: { source: "ops_maintenance_backfill_finished_run_consumption" } },
        ],
        runs
      )
    ).toBeNull()
  })

  it("adds measured logs, scaling a per-piece one by the run's pieces", () => {
    expect(
      summarizeEnergy(
        [
          { production_run_id: "r1", consumption_type: "energy_electricity", quantity: 2.5, quantity_basis: "per_piece" },
          { production_run_id: "r2", consumption_type: "energy_electricity", quantity: 3, quantity_basis: "total" },
          { production_run_id: "r2", consumption_type: "energy_water", quantity: 40 },
          { production_run_id: "r2", consumption_type: "labor", quantity: 8 },
          { production_run_id: "elsewhere", consumption_type: "energy_gas", quantity: 9 },
        ],
        runs
      )
    ).toEqual({ electricity_kwh: 13, water_liters: 40, gas_cubic_meters: 0 })
  })
})

describe("countRoles (#2444)", () => {
  it("counts people per role, without names, once per person", () => {
    expect(
      countRoles([
        { id: "a", person_types: [{ name: "Weaver" }, { name: "Weaver" }] },
        { id: "b", person_types: [{ name: "Weaver" }, { name: "Dyer" }] },
        { id: "c", person_types: [] },
      ])
    ).toEqual([
      { role: "Weaver", count: 2 },
      { role: "Dyer", count: 1 },
    ])
  })
})

describe("publicCapabilities (#2444)", () => {
  it("shows only public images and drops untitled samples", () => {
    const out = publicCapabilities(
      [
        { id: "s1", title: "Kala cotton", technique: "Handloom", actions: ["weave"], media_file_ids: ["pub", "priv", "doc", "gone"] },
        { id: "s2", title: "  " },
      ],
      [
        { id: "pub", file_path: "https://cdn/x.jpg", file_type: "image", is_public: true },
        { id: "priv", file_path: "https://cdn/y.jpg", file_type: "image", is_public: false },
        { id: "doc", file_path: "https://cdn/z.pdf", file_type: "document", is_public: true },
      ]
    )
    expect(out).toHaveLength(1)
    expect(out[0].images).toEqual([{ url: "https://cdn/x.jpg", alt: "Kala cotton" }])
  })
})
