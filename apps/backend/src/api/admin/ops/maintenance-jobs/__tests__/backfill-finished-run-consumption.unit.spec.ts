import {
  backfillFinishedRunConsumptionJob,
  buildEnergyRateMap,
  buildRunConsumptionLogs,
  computeRunConsumptionQuantities,
  getMaintenanceJob,
  MAINTENANCE_JOBS,
  MAX_RUN_CONSUMPTION_SCAN,
  summarizeRunConsumptionBackfill,
} from "../registry"

/**
 * #697 — pure logic for the `backfill-finished-run-consumption` maintenance job.
 * The container-bound run() (consumption-log lookups + createConsumptionLogs)
 * is exercised against the live DB by the API contract integration test; here we
 * lock down the quantity math, the per-run log drafts (incl. pricing + skip),
 * and the summary string without booting anything.
 */
describe("backfill-finished-run-consumption — computeRunConsumptionQuantities", () => {
  it("multiplies the day assumption into labor hours and electricity kWh", () => {
    expect(computeRunConsumptionQuantities(2.5, 8, 12)).toEqual({
      laborHours: 20,
      energyKwh: 30,
    })
  })

  it("rounds to 2 decimals", () => {
    expect(computeRunConsumptionQuantities(1.333, 8, 12)).toEqual({
      laborHours: 10.66,
      energyKwh: 16,
    })
  })

  it("collapses non-positive inputs to 0 (bucket later skipped)", () => {
    expect(computeRunConsumptionQuantities(0, 8, 12)).toEqual({
      laborHours: 0,
      energyKwh: 0,
    })
    expect(computeRunConsumptionQuantities(2.5, -1, 0)).toEqual({
      laborHours: 0,
      energyKwh: 0,
    })
  })
})

describe("backfill-finished-run-consumption — buildRunConsumptionLogs", () => {
  const rateMap = buildEnergyRateMap([
    {
      energy_type: "labor",
      rate_per_unit: 250,
      name: "Labor",
      effective_from: "2026-01-01",
    },
    {
      energy_type: "energy_electricity",
      rate_per_unit: 9.5,
      name: "Electricity",
      effective_from: "2026-01-01",
    },
  ])

  it("builds one labor + one electricity log priced from the active rates", () => {
    const drafts = buildRunConsumptionLogs(
      { id: "prod_run_1", design_id: "design_1" },
      { laborHours: 20, energyKwh: 30 },
      rateMap
    )
    expect(drafts).toEqual([
      {
        design_id: "design_1",
        production_run_id: "prod_run_1",
        consumption_type: "labor",
        unit_of_measure: "Hour",
        quantity: 20,
        unit_cost: 250,
      },
      {
        design_id: "design_1",
        production_run_id: "prod_run_1",
        consumption_type: "energy_electricity",
        unit_of_measure: "kWh",
        quantity: 30,
        unit_cost: 9.5,
      },
    ])
  })

  it("leaves unit_cost null when no rate exists (cost-summary falls back at read)", () => {
    const drafts = buildRunConsumptionLogs(
      { id: "prod_run_1", design_id: "design_1" },
      { laborHours: 20, energyKwh: 30 },
      new Map()
    )
    expect(drafts.map((d) => d.unit_cost)).toEqual([null, null])
  })

  it("omits a zero-quantity bucket", () => {
    const labourOnly = buildRunConsumptionLogs(
      { id: "prod_run_1", design_id: "design_1" },
      { laborHours: 20, energyKwh: 0 },
      rateMap
    )
    expect(labourOnly).toHaveLength(1)
    expect(labourOnly[0].consumption_type).toBe("labor")

    const none = buildRunConsumptionLogs(
      { id: "prod_run_1", design_id: "design_1" },
      { laborHours: 0, energyKwh: 0 },
      rateMap
    )
    expect(none).toHaveLength(0)
  })

  it("tolerates a missing design_id (empty string)", () => {
    const drafts = buildRunConsumptionLogs(
      { id: "prod_run_1", design_id: null },
      { laborHours: 20, energyKwh: 30 },
      rateMap
    )
    expect(drafts.every((d) => d.design_id === "")).toBe(true)
  })
})

describe("backfill-finished-run-consumption — summarizeRunConsumptionBackfill", () => {
  it("reports no-change when nothing needed a backfill", () => {
    expect(summarizeRunConsumptionBackfill(true, 5, 0, 0, 5, 0)).toBe(
      "No changes — scanned 5 finished run(s), none needed energy/labor consumption logs; 5 already had energy/labor logs"
    )
  })

  it("distinguishes dry-run (would) from apply (created)", () => {
    expect(summarizeRunConsumptionBackfill(true, 3, 2, 4, 1, 0)).toBe(
      "Would create 4 consumption log(s) across 2 finished run(s) (scanned 3); 1 already had energy/labor logs"
    )
    expect(summarizeRunConsumptionBackfill(false, 3, 2, 4, 0, 0)).toBe(
      "Created 4 consumption log(s) across 2 finished run(s) (scanned 3)"
    )
  })

  it("appends an error count when present", () => {
    expect(summarizeRunConsumptionBackfill(false, 3, 1, 2, 0, 1)).toBe(
      "Created 2 consumption log(s) across 1 finished run(s) (scanned 3); 1 error(s)"
    )
  })
})

describe("backfill-finished-run-consumption — registration", () => {
  it("is registered and resolvable by id", () => {
    expect(getMaintenanceJob("backfill-finished-run-consumption")).toBe(
      backfillFinishedRunConsumptionJob
    )
    expect(MAINTENANCE_JOBS).toContain(backfillFinishedRunConsumptionJob)
  })

  it("exposes the documented params", () => {
    expect(backfillFinishedRunConsumptionJob.params.map((p) => p.name)).toEqual([
      "production_run_id",
      "work_days",
      "hours_per_day",
      "kwh_per_day",
      "limit",
    ])
  })

  it("caps the sweep scan", () => {
    expect(MAX_RUN_CONSUMPTION_SCAN).toBe(2000)
  })
})
