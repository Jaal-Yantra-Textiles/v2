import { model } from "@medusajs/framework/utils"
import GoogleAdsCampaign from "./GoogleAdsCampaign"
import GoogleAdsAd from "./GoogleAdsAd"
import GoogleAdsInsights from "./GoogleAdsInsights"

/**
 * GoogleAdsAdGroup
 *
 * Ad groups under a synced Google Ads campaign. Kept lightweight for now —
 * we pull `id`, `name`, `status`, and `type` plus rolled-up metrics. The
 * ad-level entity is intentionally deferred until a real consumer needs it.
 */
const GoogleAdsAdGroup = model.define("GoogleAdsAdGroup", {
  id: model.id().primaryKey(),

  ad_group_id: model.text().searchable(),
  resource_name: model.text().nullable(),
  name: model.text().searchable(),

  status: model
    .enum(["UNSPECIFIED", "UNKNOWN", "ENABLED", "PAUSED", "REMOVED"])
    .default("UNSPECIFIED"),
  type: model.text().nullable(), // SEARCH_STANDARD, DISPLAY_STANDARD, etc.

  impressions: model.bigNumber().default(0),
  clicks: model.bigNumber().default(0),
  conversions: model.bigNumber().default(0),
  cost_micros: model.bigNumber().default(0),

  last_synced_at: model.dateTime().nullable(),

  campaign: model.belongsTo(() => GoogleAdsCampaign, {
    mappedBy: "ad_groups",
  }),
  ads: model.hasMany(() => GoogleAdsAd, { mappedBy: "ad_group" }),
  insights: model.hasMany(() => GoogleAdsInsights, { mappedBy: "ad_group" }),

  metadata: model.json().nullable(),
})
.indexes([
  {
    on: ["ad_group_id"],
    name: "idx_google_ads_ad_group_id",
  },
])

export default GoogleAdsAdGroup
