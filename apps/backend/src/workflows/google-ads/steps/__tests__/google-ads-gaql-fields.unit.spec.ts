import {
  AGGREGATE_METRICS_FIELDS,
  CAMPAIGN_DATES_QUERY,
  buildCampaignAggregateQuery,
  buildDailyInsightsQuery,
} from "../sync-google-ads-step"

/**
 * Regression guard for the v24 GAQL field-name drift (queryError:UNRECOGNIZED_FIELD).
 * Google renamed the video CPV/view metrics to the TrueView namespace and rejects
 * campaign.start_date/end_date when selected alongside segments.date + metrics.
 */
describe("google-ads GAQL field selection (v24)", () => {
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
      buildCampaignAggregateQuery(30),
      buildDailyInsightsQuery("campaign", 30),
      buildDailyInsightsQuery("ad_group", 30),
      buildDailyInsightsQuery("ad", 30),
    ]
    for (const q of queries) {
      for (const removed of REMOVED_METRICS) {
        // word-boundary so trueview_average_cpv isn't caught by average_cpv
        expect(q).not.toMatch(new RegExp(`${removed}\\b`))
      }
    }
  })

  it("does NOT select campaign date attributes in the segmented aggregate query", () => {
    const q = buildCampaignAggregateQuery(30)
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
