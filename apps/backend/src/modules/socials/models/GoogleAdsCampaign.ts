import { model } from "@medusajs/framework/utils"
import GoogleAdsCustomer from "./GoogleAdsCustomer"
import GoogleAdsAdGroup from "./GoogleAdsAdGroup"

/**
 * GoogleAdsCampaign
 *
 * A Google Ads campaign synced from the Ads API via GAQL. Lives parallel to
 * the Meta `AdCampaign` table — Google's `advertising_channel_type` and
 * status enums don't overlap with Meta's `objective`/`buying_type`, so
 * keeping them split avoids constant per-network branching.
 */
const GoogleAdsCampaign = model.define("GoogleAdsCampaign", {
  id: model.id().primaryKey(),

  // Google identifiers
  campaign_id: model.text().searchable(), // numeric campaign id from Google
  resource_name: model.text().nullable(), // "customers/{cid}/campaigns/{id}"
  name: model.text().searchable(),

  // Campaign config
  status: model
    .enum(["UNSPECIFIED", "UNKNOWN", "ENABLED", "PAUSED", "REMOVED"])
    .default("UNSPECIFIED"),
  serving_status: model.text().nullable(), // SERVING, NONE, ENDED, PENDING, SUSPENDED
  advertising_channel_type: model
    .enum([
      "UNSPECIFIED",
      "UNKNOWN",
      "SEARCH",
      "DISPLAY",
      "SHOPPING",
      "HOTEL",
      "VIDEO",
      "MULTI_CHANNEL",
      "LOCAL",
      "SMART",
      "PERFORMANCE_MAX",
      "LOCAL_SERVICES",
      "TRAVEL",
      "DEMAND_GEN",
    ])
    .default("UNSPECIFIED"),
  bidding_strategy_type: model.text().nullable(),

  // Schedule
  start_date: model.text().nullable(), // YYYY-MM-DD as Google returns
  end_date: model.text().nullable(),

  // Budget — micros: integer * 1e-6 currency units
  budget_amount_micros: model.bigNumber().nullable(),

  // Performance metrics — last GAQL pull
  impressions: model.bigNumber().default(0),
  clicks: model.bigNumber().default(0),
  conversions: model.bigNumber().default(0),
  cost_micros: model.bigNumber().default(0),

  // Sync metadata
  last_synced_at: model.dateTime().nullable(),

  // Relationships
  customer: model.belongsTo(() => GoogleAdsCustomer, {
    mappedBy: "campaigns",
  }),
  ad_groups: model.hasMany(() => GoogleAdsAdGroup, {
    mappedBy: "campaign",
  }),

  metadata: model.json().nullable(),
})
.indexes([
  {
    on: ["campaign_id"],
    name: "idx_google_ads_campaign_id",
  },
])

export default GoogleAdsCampaign
