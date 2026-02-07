import { model } from "@medusajs/framework/utils"

/**
 * CampaignAttribution
 *
 * Links analytics sessions to ad campaigns via UTM parameter resolution.
 * This model bridges the gap between anonymous website visitors and
 * the specific ad campaigns that drove them to the site.
 */
const CampaignAttribution = model.define("CampaignAttribution", {
  id: model.id().primaryKey(),

  // Source analytics data
  analytics_session_id: model.text(), // Primary key from AnalyticsSession
  visitor_id: model.text(),
  website_id: model.text(),

  // Attributed campaign (resolved)
  ad_campaign_id: model.text().nullable(), // Links to AdCampaign
  ad_set_id: model.text().nullable(), // Links to AdSet
  ad_id: model.text().nullable(), // Links to Ad
  platform: model.enum(["meta", "google", "generic"]).default("meta"),

  // UTM data (raw)
  utm_source: model.text().nullable(),
  utm_medium: model.text().nullable(),
  utm_campaign: model.text().nullable(),
  utm_term: model.text().nullable(),
  utm_content: model.text().nullable(),

  // Resolution status
  is_resolved: model.boolean().default(false), // Whether UTM was matched to campaign
  resolution_confidence: model.float().nullable(), // 0-1 confidence score
  resolution_method: model.enum([
    "exact_utm_match",
    "fuzzy_name_match",
    "manual",
    "unresolved"
  ]).default("unresolved"),

  // Session metrics at attribution time
  entry_page: model.text().nullable(),
  session_pageviews: model.number().default(1),

  // Timestamps
  attributed_at: model.dateTime(),
  session_started_at: model.dateTime(),

  // Metadata
  metadata: model.json().nullable(),
})
.indexes([
  {
    on: ["analytics_session_id"],
    unique: true,
    name: "idx_attribution_session_unique",
  },
  {
    on: ["ad_campaign_id"],
    name: "idx_attribution_campaign",
  },
  {
    on: ["is_resolved"],
    name: "idx_attribution_resolved",
  },
  {
    on: ["website_id", "attributed_at"],
    name: "idx_attribution_website_time",
  },
  {
    on: ["utm_campaign"],
    name: "idx_attribution_utm_campaign",
  },
])

export default CampaignAttribution
