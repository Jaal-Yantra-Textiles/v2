import { model } from "@medusajs/framework/utils"
import GoogleAdsCustomer from "./GoogleAdsCustomer"
import GoogleAdsCampaign from "./GoogleAdsCampaign"
import GoogleAdsAdGroup from "./GoogleAdsAdGroup"
import GoogleAdsAd from "./GoogleAdsAd"

/**
 * GoogleAdsInsights (Google Ads time-series performance)
 *
 * Mirrors Meta's `AdInsights`: stores per-day metric snapshots at one of
 * four levels (customer/campaign/ad_group/ad). Each sync appends rows
 * keyed by `(level, entity_id, date, breakdown_key)` so re-syncs replace
 * the same row rather than duplicating.
 *
 * Why a separate table from the campaign/ad_group/ad rows: those carry
 * the latest sync's rolled-up numbers for picker UIs and quick scans.
 * Insights is the audit log — historical trends, breakdowns, video
 * funnel, conversion value — and is the surface the unified `/admin/ads/
 * insights` endpoint queries against.
 */
const GoogleAdsInsights = model.define("GoogleAdsInsights", {
  id: model.id().primaryKey(),

  // Granularity. We always store DAILY rows today; weekly / monthly are
  // computed on read. Keeping the column means the unified Meta+Google
  // response shape stays consistent.
  date: model.text(), // YYYY-MM-DD — Google returns ISO date strings
  time_increment: model.text().default("1"), // "1" = daily

  // Which level this row aggregates. Exactly one of the four entity FKs
  // is non-null at any time — at-rest validation is done in the upsert
  // step, not via a CHECK constraint, since MikroORM's relation helpers
  // can't express "exactly one of N" cleanly.
  level: model.enum(["customer", "campaign", "ad_group", "ad"]),

  // ============ CORE METRICS ============
  impressions: model.bigNumber().default(0),
  clicks: model.bigNumber().default(0),
  ctr: model.float().nullable(),

  // Spend
  cost_micros: model.bigNumber().default(0),
  average_cpc_micros: model.bigNumber().nullable(),
  average_cpm_micros: model.bigNumber().nullable(),
  average_cpv_micros: model.bigNumber().nullable(),

  // ============ CONVERSIONS ============
  conversions: model.float().default(0), // GAQL returns float (fractional attribution)
  conversions_value: model.float().nullable(),
  all_conversions: model.float().nullable(),
  all_conversions_value: model.float().nullable(),
  view_through_conversions: model.float().nullable(),
  cost_per_conversion_micros: model.bigNumber().nullable(),

  // ============ VIDEO METRICS ============
  video_views: model.bigNumber().nullable(),
  video_view_rate: model.float().nullable(),
  video_quartile_p25_rate: model.float().nullable(),
  video_quartile_p50_rate: model.float().nullable(),
  video_quartile_p75_rate: model.float().nullable(),
  video_quartile_p100_rate: model.float().nullable(),

  // ============ ENGAGEMENT / SEARCH-SPECIFIC ============
  engagements: model.bigNumber().nullable(),
  engagement_rate: model.float().nullable(),
  interactions: model.bigNumber().nullable(),
  interaction_rate: model.float().nullable(),
  search_impression_share: model.float().nullable(),
  search_top_impression_share: model.float().nullable(),
  search_absolute_top_impression_share: model.float().nullable(),

  // ============ BREAKDOWN DIMENSIONS ============
  // Only one breakdown kind is set per row — e.g. `device="MOBILE"` for
  // device-segmented insights. Composite breakdowns (device+geo) are
  // stored as separate rows with both fields populated.
  device: model.text().nullable(), // MOBILE | DESKTOP | TABLET | CONNECTED_TV | OTHER
  network: model.text().nullable(), // SEARCH | SEARCH_PARTNERS | CONTENT | YOUTUBE_SEARCH | YOUTUBE_WATCH
  geo_country_code: model.text().nullable(), // ISO 3166-1 alpha-2
  geo_region: model.text().nullable(),

  // ============ RELATIONSHIPS ============
  // Polymorphic-by-nullability. At most one of the four is set per row.
  customer: model
    .belongsTo(() => GoogleAdsCustomer, { mappedBy: "insights" })
    .nullable(),
  campaign: model
    .belongsTo(() => GoogleAdsCampaign, { mappedBy: "insights" })
    .nullable(),
  ad_group: model
    .belongsTo(() => GoogleAdsAdGroup, { mappedBy: "insights" })
    .nullable(),
  ad: model.belongsTo(() => GoogleAdsAd, { mappedBy: "insights" }).nullable(),

  // ============ METADATA ============
  currency_code: model.text().nullable(),
  raw_data: model.json().nullable(), // full GAQL row for debugging
  synced_at: model.dateTime(),
}).indexes([
  {
    on: ["level", "date"],
    name: "idx_google_ads_insights_level_date",
  },
])

export default GoogleAdsInsights
