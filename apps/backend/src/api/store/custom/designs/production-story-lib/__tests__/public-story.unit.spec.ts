import { buildProductionStory, piecesMade, toPublicActivity, toStoryTeaser } from "../build-story"
import { buildStoryEmailData } from "../story-email-data"

const act = (id: string, activity_type: string, kind: string, day: number, summary = "internal words") => ({
  id,
  activity_type,
  kind,
  summary,
  created_at: new Date(`2026-10-${String(day).padStart(2, "0")}T00:00:00Z`),
})

const story = () =>
  buildProductionStory({
    designId: "des_1",
    runs: [{ id: "run_1", status: "completed", run_type: "production", created_at: new Date("2026-10-01T00:00:00Z") }],
    activitiesByRun: {
      run_1: [
        act("a1", "lifecycle_event", "sent_to_partner", 1),
        act("a2", "reminder_sent", "idle", 2, "Reminder: partner has not started"),
        act("a3", "lifecycle_event", "accepted", 3),
        act("a4", "note", "admin_comment", 4, "pay them less next time"),
        act("a5", "lifecycle_event", "started_by_admin", 5),
        act("a6", "system", "consumption_applied", 6),
        act("a7", "lifecycle_event", "finished", 7),
        act("a8", "lifecycle_event", "completed", 8),
        act("a9", "lifecycle_event", "cancelled", 9),
      ],
    },
    logs: [{ consumption_type: "energy_electricity", quantity: 12, unit_of_measure: "kWh" }],
    personLinks: [{ role: "Tailor", person: { id: "p1", first_name: "Asha", last_name: "Devi" } }],
    partners: [{ id: "pt1", name: "Sharlho" }],
    inventoryItems: [{ raw_materials: { id: "rm1", name: "Kala Cotton" } }],
  })

describe("production story — what a shopper may see", () => {
  it("keeps only allowlisted lifecycle stages, in our words", () => {
    const labels = story().runs[0].activity.map((a) => a.summary)
    expect(labels).toEqual([
      "Sent to the maker",
      "Accepted by the maker",
      "Work started",
      "Work finished",
      "Completed",
    ])
    expect(JSON.stringify(story())).not.toMatch(/Reminder|pay them less|internal words/)
  })

  it("drops reminders, notes, system rows and cancellations", () => {
    expect(toPublicActivity({ activity_type: "reminder_sent", kind: "idle" })).toBeNull()
    expect(toPublicActivity({ activity_type: "note", kind: "completed" })).toBeNull()
    expect(toPublicActivity({ activity_type: "lifecycle_event", kind: "cancelled" })).toBeNull()
  })
})

describe("public teaser — the page and the API show the same", () => {
  it("shows the first and last step and counts the rest", () => {
    const teaser = toStoryTeaser(story())
    expect(teaser.journey.steps.map((s) => s.label)).toEqual(["Sent to the maker", "Completed"])
    expect(teaser.journey.hidden_steps).toBe(3)
  })

  it("withholds people, energy and per-run steps from the data", () => {
    const teaser = toStoryTeaser(story())
    expect(teaser.people).toEqual([])
    expect(teaser.consumption.energy.electricity_kwh).toBe(0)
    expect(teaser.runs[0].activity).toEqual([])
    expect(JSON.stringify(teaser)).not.toMatch(/Asha|Accepted by the maker|Work started/)
  })

  it("keeps what sells: makers and materials", () => {
    const teaser = toStoryTeaser(story())
    expect(teaser.partners.map((p) => p.name)).toEqual(["Sharlho"])
    expect(teaser.materials.map((m) => m.name)).toEqual(["Kala Cotton"])
  })
})

describe("public impact — measured energy per piece", () => {
  const withRuns = (runs: any[], logs: any[]) =>
    buildProductionStory({
      designId: "des_2",
      runs,
      activitiesByRun: {},
      logs,
      personLinks: [],
      partners: [],
      inventoryItems: [],
    })

  it("divides the measured totals by the pieces made", () => {
    const teaser = toStoryTeaser(
      withRuns(
        [{ id: "r1", status: "completed", produced_quantity: 4 }],
        [
          { consumption_type: "energy_electricity", quantity: 10, unit_of_measure: "kWh" },
          { consumption_type: "energy_water", quantity: 6, unit_of_measure: "L" },
        ]
      )
    )
    expect(teaser.impact).toEqual({
      measured: true,
      pieces_made: 4,
      per_piece: { electricity_kwh: 2.5, water_liters: 1.5, gas_cubic_meters: 0 },
    })
    // the batch total itself stays email-only
    expect(teaser.consumption.energy.electricity_kwh).toBe(0)
  })

  it("counts a batch once across its stage runs, and adds batches", () => {
    expect(
      piecesMade([
        { id: "root", parent_run_id: null, status: "completed", produced_quantity: 2 },
        { id: "stitch", parent_run_id: "root", status: "completed", produced_quantity: 2 },
        { id: "embroider", parent_run_id: "root", status: "completed", produced_quantity: 2 },
        { id: "root2", parent_run_id: null, status: "completed", produced_quantity: 5 },
        { id: "open", parent_run_id: null, status: "in_progress", produced_quantity: 9 },
      ] as any)
    ).toBe(7)
  })

  it("says not measured when nothing was logged or nothing is made yet", () => {
    const noLogs = toStoryTeaser(withRuns([{ id: "r1", status: "completed", produced_quantity: 3 }], []))
    expect(noLogs.impact).toEqual({ measured: false, pieces_made: 3, per_piece: null })
    const noPieces = toStoryTeaser(
      withRuns(
        [{ id: "r1", status: "in_progress" }],
        [{ consumption_type: "energy_electricity", quantity: 5, unit_of_measure: "kWh" }]
      )
    )
    expect(noPieces.impact.measured).toBe(false)
    expect(noPieces.impact.per_piece).toBeNull()
  })
})

describe("emailed story — everything the teaser withheld", () => {
  it("carries every step, the people and the energy", () => {
    const data = buildStoryEmailData({ story: story(), productTitle: "Short Story Dress" })
    expect(data.title).toBe("Short Story Dress")
    expect(data.steps.map((s) => s.label)).toHaveLength(5)
    expect(data.people).toEqual(["Asha Devi (Tailor)"])
    expect(data.makers).toEqual(["Sharlho"])
    expect(data.energy).toEqual(["Electricity: 12 kWh"])
  })
})
