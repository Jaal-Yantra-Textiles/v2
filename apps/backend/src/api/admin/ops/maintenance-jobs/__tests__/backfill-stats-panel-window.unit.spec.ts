import {
  backfillStatsPanelWindowJob,
  diffStatsPanelWindow,
  getMaintenanceJob,
  MAINTENANCE_JOBS,
  MAX_STATS_PANEL_SCAN,
  summarizeStatsPanelWindowBackfill,
} from "../registry"

/**
 * #522 — pure logic for the `backfill-stats-panel-window` maintenance job. The
 * container-bound run() (listAndCountStatsPanels + updateStatsPanels) is the
 * thin IO shell; here we lock down the "does this panel need a window?" decision
 * and the summary string without booting the DB.
 */
describe("backfill-stats-panel-window — diffStatsPanelWindow", () => {
  const baseUnique = {
    id: "panel_uv",
    operation_type: "aggregate_data",
    operation_options: {
      entity: "analytics_daily_stats",
      aggregate: { fn: "sum", field: "unique_visitors" },
    },
  }

  it("adds dateField + range to an unwindowed unique_visitors panel (scan mode)", () => {
    const change = diffStatsPanelWindow(baseUnique, {
      dateField: "date",
      lastDays: 30,
      field: "unique_visitors",
      targeted: false,
    })
    expect(change).toEqual({
      entity: "stats_panel",
      id: "panel_uv",
      field: "operation_options",
      before: {
        entity: "analytics_daily_stats",
        aggregate: { fn: "sum", field: "unique_visitors" },
      },
      after: {
        entity: "analytics_daily_stats",
        aggregate: { fn: "sum", field: "unique_visitors" },
        dateField: "date",
        range: { last_days: 30 },
      },
    })
  })

  it("is idempotent — a panel that already has a range is skipped", () => {
    const change = diffStatsPanelWindow(
      {
        ...baseUnique,
        operation_options: {
          ...baseUnique.operation_options,
          dateField: "date",
          range: { last_days: 30 },
        },
      },
      { dateField: "date", lastDays: 30, field: "unique_visitors", targeted: false }
    )
    expect(change).toBeNull()
  })

  it("preserves an existing dateField rather than overwriting it", () => {
    const change = diffStatsPanelWindow(
      {
        ...baseUnique,
        operation_options: { ...baseUnique.operation_options, dateField: "created_at" },
      },
      { dateField: "date", lastDays: 7, field: "unique_visitors", targeted: false }
    )
    expect(change?.after).toMatchObject({
      dateField: "created_at",
      range: { last_days: 7 },
    })
  })

  it("scan mode skips aggregate_data panels aggregating a different field", () => {
    const change = diffStatsPanelWindow(
      {
        id: "panel_pv",
        operation_type: "aggregate_data",
        operation_options: {
          entity: "analytics_daily_stats",
          aggregate: { fn: "sum", field: "pageviews" },
        },
      },
      { dateField: "date", lastDays: 30, field: "unique_visitors", targeted: false }
    )
    expect(change).toBeNull()
  })

  it("targeted mode patches the panel regardless of aggregate.field", () => {
    const change = diffStatsPanelWindow(
      {
        id: "panel_pv",
        operation_type: "aggregate_data",
        operation_options: {
          entity: "analytics_daily_stats",
          aggregate: { fn: "sum", field: "pageviews" },
        },
      },
      { dateField: "date", lastDays: 30, field: "unique_visitors", targeted: true }
    )
    expect(change?.id).toBe("panel_pv")
    expect(change?.after).toMatchObject({ range: { last_days: 30 } })
  })

  it("never touches non-aggregate_data panels (time_series carries its own range)", () => {
    const change = diffStatsPanelWindow(
      {
        id: "panel_ts",
        operation_type: "time_series",
        operation_options: { entity: "analytics_daily_stats" },
      },
      { dateField: "date", lastDays: 30, field: "unique_visitors", targeted: true }
    )
    expect(change).toBeNull()
  })

  it("handles a null/empty operation_options without throwing", () => {
    const change = diffStatsPanelWindow(
      { id: "panel_x", operation_type: "aggregate_data", operation_options: null },
      { dateField: "date", lastDays: 30, field: "unique_visitors", targeted: true }
    )
    // No aggregate.field, but targeted mode patches it anyway.
    expect(change?.after).toEqual({ dateField: "date", range: { last_days: 30 } })
  })
})

describe("backfill-stats-panel-window — summarizeStatsPanelWindowBackfill", () => {
  it("reports a no-op when nothing changed", () => {
    expect(summarizeStatsPanelWindowBackfill(true, 5, 0, 30)).toMatch(
      /No changes — all 5 scanned panel/
    )
  })

  it("uses 'Would add' for dry-run and 'Added' for apply", () => {
    expect(summarizeStatsPanelWindowBackfill(true, 5, 1, 30)).toMatch(/Would add a 30-day window to 1 of 5/)
    expect(summarizeStatsPanelWindowBackfill(false, 5, 2, 7)).toMatch(/Added a 7-day window to 2 of 5/)
  })
})

describe("backfill-stats-panel-window — registry wiring", () => {
  it("is registered in MAINTENANCE_JOBS and resolvable by id", () => {
    expect(MAINTENANCE_JOBS).toContain(backfillStatsPanelWindowJob)
    expect(getMaintenanceJob("backfill-stats-panel-window")).toBe(backfillStatsPanelWindowJob)
  })

  it("exposes the documented params and a sane scan cap", () => {
    const names = backfillStatsPanelWindowJob.params.map((p) => p.name)
    expect(names).toEqual(["panel_id", "last_days", "date_field", "field"])
    expect(backfillStatsPanelWindowJob.params.every((p) => !p.required)).toBe(true)
    expect(MAX_STATS_PANEL_SCAN).toBeGreaterThan(0)
  })
})
