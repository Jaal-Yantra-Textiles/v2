import {
  backfillConsumptionLogProductionRunIdJob,
  diffConsumptionLogProductionRunId,
  getMaintenanceJob,
  MAINTENANCE_JOBS,
  MAX_CONSUMPTION_BACKFILL_SCAN,
  summarizeConsumptionLogBackfill,
} from "../registry"

/**
 * #508 slice 6 — pure logic for the `backfill-consumption-log-production-run-id`
 * maintenance job. The container-bound run() (query.graph over the
 * production_run↔consumption_log link + the column update) is exercised by the
 * API contract integration test; here we lock down the
 * fill / skip / ambiguous / already-set decision and the summary string without
 * booting the DB.
 */
describe("backfill-consumption-log-production-run-id — diffConsumptionLogProductionRunId", () => {
  it("fills the column from the link when exactly one run is linked and the column is null", () => {
    const { decision, changes } = diffConsumptionLogProductionRunId(
      "clog_1",
      null,
      ["run_1"]
    )
    expect(decision).toBe("filled")
    expect(changes).toEqual([
      {
        entity: "consumption_log",
        id: "clog_1",
        field: "production_run_id",
        before: null,
        after: "run_1",
      },
    ])
  })

  it("never overwrites an already-set column (idempotent)", () => {
    const { decision, changes } = diffConsumptionLogProductionRunId(
      "clog_1",
      "run_existing",
      ["run_other"]
    )
    expect(decision).toBe("already_set")
    expect(changes).toEqual([])
  })

  it("skips a log with no linked run (sample/energy/labor — null is correct)", () => {
    const { decision, changes } = diffConsumptionLogProductionRunId(
      "clog_1",
      null,
      []
    )
    expect(decision).toBe("no_link")
    expect(changes).toEqual([])
  })

  it("treats an empty-string current value as unset and fills it", () => {
    const { decision, changes } = diffConsumptionLogProductionRunId(
      "clog_1",
      "",
      ["run_1"]
    )
    expect(decision).toBe("filled")
    expect(changes[0].after).toBe("run_1")
  })

  it("is unambiguous when the same run is linked twice (dedupes)", () => {
    const { decision, changes } = diffConsumptionLogProductionRunId(
      "clog_1",
      null,
      ["run_1", "run_1"]
    )
    expect(decision).toBe("filled")
    expect(changes).toHaveLength(1)
    expect(changes[0].after).toBe("run_1")
  })

  it("is ambiguous (skipped) when linked to multiple distinct runs", () => {
    const { decision, changes } = diffConsumptionLogProductionRunId(
      "clog_1",
      null,
      ["run_1", "run_2"]
    )
    expect(decision).toBe("ambiguous")
    expect(changes).toEqual([])
  })

  it("ignores empty-string linked ids", () => {
    const { decision, changes } = diffConsumptionLogProductionRunId(
      "clog_1",
      null,
      ["", ""]
    )
    expect(decision).toBe("no_link")
    expect(changes).toEqual([])
  })
})

describe("backfill-consumption-log-production-run-id — summarizeConsumptionLogBackfill", () => {
  it("reports no changes when nothing needs a backfill", () => {
    expect(summarizeConsumptionLogBackfill(true, 4, 0, 0, 0)).toBe(
      "No changes — scanned 4 linked consumption log(s), none need a production_run_id backfill"
    )
  })

  it("uses 'Would backfill' for a dry run", () => {
    expect(summarizeConsumptionLogBackfill(true, 5, 3, 0, 0)).toBe(
      "Would backfill production_run_id on 3 consumption log(s) from their production-run link (scanned 5)"
    )
  })

  it("uses 'Backfilled' for an applied run and appends ambiguous + error clauses", () => {
    expect(summarizeConsumptionLogBackfill(false, 10, 6, 2, 1)).toBe(
      "Backfilled production_run_id on 6 consumption log(s) from their production-run link (scanned 10); 2 ambiguous (linked to multiple runs) skipped; 1 error(s)"
    )
  })

  it("mentions ambiguous skips even when nothing was filled", () => {
    expect(summarizeConsumptionLogBackfill(true, 3, 0, 1, 0)).toBe(
      "No changes — scanned 3 linked consumption log(s), none need a production_run_id backfill; 1 ambiguous (linked to multiple runs) skipped"
    )
  })
})

describe("backfill-consumption-log-production-run-id — registry wiring", () => {
  it("is registered and discoverable by id", () => {
    expect(getMaintenanceJob("backfill-consumption-log-production-run-id")).toBe(
      backfillConsumptionLogProductionRunIdJob
    )
    expect(MAINTENANCE_JOBS).toContain(backfillConsumptionLogProductionRunIdJob)
  })

  it("declares optional production_run_id + limit params and a sane cap", () => {
    expect(MAX_CONSUMPTION_BACKFILL_SCAN).toBeGreaterThan(0)
    const names = backfillConsumptionLogProductionRunIdJob.params.map((p) => p.name)
    expect(names).toEqual(
      expect.arrayContaining(["production_run_id", "limit"])
    )
    expect(
      backfillConsumptionLogProductionRunIdJob.params.every(
        (p) => p.required === false
      )
    ).toBe(true)
  })
})
