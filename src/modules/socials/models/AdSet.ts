import { model } from "@medusajs/framework/utils"
import AdCampaign from "./AdCampaign"
import Ad from "./Ad"

/**
 * AdSet (Meta Ad Set)
 * 
 * Represents a Meta ad set within a campaign.
 * Ad sets define targeting, placements, budget, and schedule.
 * 
 * @property meta_adset_id - Meta's ad set ID
 * @property targeting - JSON object with targeting configuration
 * @property optimization_goal - What Meta optimizes for
 */
const AdSet = model.define("AdSet", {
  id: model.id().primaryKey(),
  
  // Meta identifiers
  meta_adset_id: model.text(),
  name: model.text().searchable(),
  
  // Status
  status: model.enum(["ACTIVE", "PAUSED", "DELETED", "ARCHIVED"]).default("PAUSED"),
  effective_status: model.text().nullable(),
  configured_status: model.text().nullable(),
  
  // Budget & Bidding
  daily_budget: model.bigNumber().nullable(),
  lifetime_budget: model.bigNumber().nullable(),
  budget_remaining: model.bigNumber().nullable(),
  bid_amount: model.bigNumber().nullable(),
  bid_strategy: model.text().nullable(), // LOWEST_COST_WITHOUT_CAP, COST_CAP, etc.
  billing_event: model.enum([
    "IMPRESSIONS",
    "LINK_CLICKS",
    "APP_INSTALLS",
    "PAGE_LIKES",
    "POST_ENGAGEMENT",
    "VIDEO_VIEWS",
    "THRUPLAY",
    "OTHER"
  ]).default("IMPRESSIONS"),
  
  // Optimization
  optimization_goal: model.text().nullable(), // LINK_CLICKS, LEAD_GENERATION, etc.
  
  // Targeting (complex JSON structure)
  targeting: model.json().nullable(),
  
  // Placements
  placements: model.json().nullable(), // Automatic or manual placements
  
  // Schedule
  start_time: model.dateTime().nullable(),
  end_time: model.dateTime().nullable(),
  
  // Performance metrics
  impressions: model.bigNumber().default(0),
  clicks: model.bigNumber().default(0),
  spend: model.bigNumber().default(0),
  reach: model.bigNumber().default(0),
  leads: model.bigNumber().default(0),
  
  // Cost metrics
  cpc: model.float().nullable(),
  cpm: model.float().nullable(),
  ctr: model.float().nullable(),
  cost_per_lead: model.float().nullable(),
  
  // Sync
  last_synced_at: model.dateTime().nullable(),
  
  // Relationships
  campaign: model.belongsTo(() => AdCampaign, { mappedBy: "ad_sets" }),
  ads: model.hasMany(() => Ad, { mappedBy: "ad_set" }),
  
  // Additional metadata
  metadata: model.json().nullable(),
})

export default AdSet
