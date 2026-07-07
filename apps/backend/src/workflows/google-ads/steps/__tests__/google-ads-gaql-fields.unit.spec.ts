import {
  AGGREGATE_METRICS_FIELDS,
  CAMPAIGN_DATES_QUERY,
  buildCampaignAggregateQuery,
  buildDailyInsightsQuery,
  buildDateClause,
  resolveSyncDateRange,
  sumBaseInsightRows,
} from "../sync-google-ads-step"

/**
 * Regression guard for the v24 GAQL field-name drift (queryError:UNRECOGNIZED_FIELD).
 * Google renamed the video CPV/view metrics to the TrueView namespace and rejects
 * campaign.start_date/end_date when selected alongside segments.date + metrics.
 */
describe("google-ads GAQL field selection (v24)", () => {
  const DATE_CLAUSE = "segments.date BETWEEN '2026-06-01' AND '2026-07-01'"

  // Removed/renamed in v24 — selecting any of these 400s the whole query.
  const REMOVED_METRICS = [
    "metrics.average_cpv",
    "metrics.video_views",
    "metrics.video_view_rate",
  ]

  it("uses the v24 TrueView metric names, not the removed ones", () => {
    expect(AGGREGATE_METRICS_FIELDS).toContain("metrics.trueview_average_cpv")
    expect(AGGREGATE_METRICS_FIELDS).toContain("metrics.video_trueview_views")
    expect(AGGREGATE_METRICS_FIELDS).toContain(
      "metrics.video_trueview_view_rate"
    )
    for (const removed of REMOVED_METRICS) {
      expect(AGGREGATE_METRICS_FIELDS).not.toContain(removed)
    }
  })

  it("never selects a removed metric in any metric-bearing query", () => {
    const queries = [
      buildCampaignAggregateQuery(DATE_CLAUSE),
      buildDailyInsightsQuery("campaign", DATE_CLAUSE),
      buildDailyInsightsQuery("ad_group", DATE_CLAUSE),
      buildDailyInsightsQuery("ad", DATE_CLAUSE),
    ]
    for (const q of queries) {
      for (const removed of REMOVED_METRICS) {
        // word-boundary so trueview_average_cpv isn't caught by average_cpv
        expect(q).not.toMatch(new RegExp(`${removed}\\b`))
      }
    }
  })

  it("does NOT select campaign date attributes in the segmented aggregate query", () => {
    const q = buildCampaignAggregateQuery(DATE_CLAUSE)
    expect(q).toContain("segments.date")
    expect(q).not.toContain("campaign.start_date")
    expect(q).not.toContain("campaign.end_date")
  })

  it("pulls campaign start/end dates in a separate metric-free query", () => {
    expect(CAMPAIGN_DATES_QUERY).toContain("campaign.start_date")
    expect(CAMPAIGN_DATES_QUERY).toContain("campaign.end_date")
    expect(CAMPAIGN_DATES_QUERY).not.toContain("segments.date")
    expect(CAMPAIGN_DATES_QUERY).not.toContain("metrics.")
  })
})

/**
 * The date window must be an explicit `BETWEEN` range, never the `LAST_N_DAYS`
 * literal — that literal only accepts 7/14/30, so any other window_days 400s
 * and a full historical backfill is impossible.
 */
describe("google-ads sync date range", () => {
  const NOW = new Date("2026-07-07T12:00:00Z")

  it("never emits a LAST_N_DAYS literal", () => {
    const q = buildCampaignAggregateQuery(
      buildDateClause(resolveSyncDateRange({ window_days: 90 }, NOW))
    )
    expect(q).not.toMatch(/LAST_\d+_DAYS/)
    expect(q).toContain("segments.date BETWEEN")
  })

  it("computes start = end − window_days (arbitrary N works)", () => {
    const r = resolveSyncDateRange({ window_days: 90 }, NOW)
    expect(r.end).toBe("2026-07-07")
    expect(r.start).toBe("2026-04-08") // 90 days before
  })

  it("defaults to a 30-day window", () => {
    const r = resolveSyncDateRange({}, NOW)
    expect(r.start).toBe("2026-06-07")
    expect(r.end).toBe("2026-07-07")
  })

  it("honours an explicit start_date (full backfill) over window_days", () => {
    const r = resolveSyncDateRange(
      { start_date: "2020-01-01", window_days: 30 },
      NOW
    )
    expect(r.start).toBe("2020-01-01")
    expect(r.end).toBe("2026-07-07")
  })

  it("caps the window at ~10y to avoid an unbounded query", () => {
    const r = resolveSyncDateRange({ window_days: 999999 }, NOW)
    expect(r.start).toBe("2016-07-09") // 3650 days before NOW
  })

  it("rejects a non-ISO / injection-y date and falls back", () => {
    const r = resolveSyncDateRange(
      { start_date: "2020-01-01' OR '1'='1", end_date: "garbage" },
      NOW
    )
    // malformed start_date ignored → window fallback; malformed end_date → today
    expect(r.start).toBe("2026-06-07")
    expect(r.end).toBe("2026-07-07")
    expect(buildDateClause(r)).not.toContain("OR")
  })
})

describe("google-ads rollups derived from stored insights", () => {
  it("sums base rows across all dates (paused-campaign history is preserved)", () => {
    const rows = [
      { date: "2026-04-16", impressions: 100, clicks: 10, conversions: 1, cost_micros: 5_000_000, device: null, network: null },
      { date: "2026-04-17", impressions: 200, clicks: 20, conversions: 0, cost_micros: 7_000_000, device: null, network: null },
    ]
    expect(sumBaseInsightRows(rows)).toEqual({
      impressions: 300,
      clicks: 30,
      conversions: 1,
      cost_micros: 12_000_000,
    })
  })

  it("skips device/network breakdown rows so they aren't double-counted", () => {
    const rows = [
      { impressions: 100, clicks: 10, conversions: 1, cost_micros: 5_000_000, device: null, network: null },
      { impressions: 40, clicks: 4, conversions: 0, cost_micros: 2_000_000, device: "MOBILE", network: null },
      { impressions: 60, clicks: 6, conversions: 1, cost_micros: 3_000_000, device: "DESKTOP", network: null },
    ]
    // only the base row counts
    expect(sumBaseInsightRows(rows)).toEqual({
      impressions: 100,
      clicks: 10,
      conversions: 1,
      cost_micros: 5_000_000,
    })
  })

  it("coerces string metrics and treats missing as 0", () => {
    const rows = [
      { impressions: "150", clicks: "5", cost_micros: "1000000", device: null, network: null },
    ]
    expect(sumBaseInsightRows(rows)).toEqual({
      impressions: 150,
      clicks: 5,
      conversions: 0,
      cost_micros: 1_000_000,
    })
  })

  it("returns all-zero for an empty set", () => {
    expect(sumBaseInsightRows([])).toEqual({
      impressions: 0,
      clicks: 0,
      conversions: 0,
      cost_micros: 0,
    })
  })
})
