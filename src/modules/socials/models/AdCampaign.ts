import { model } from "@medusajs/framework/utils"
import AdAccount from "./AdAccount"
import AdSet from "./AdSet"
import AdInsights from "./AdInsights"

/**
 * AdCampaign (Meta Ad Campaign)
 * 
 * Represents a Meta advertising campaign.
 * Campaigns are the top-level container for ad sets and ads.
 * 
 * @property meta_campaign_id - Meta's campaign ID
 * @property objective - Campaign objective (LEADS, CONVERSIONS, etc.)
 * @property status - Campaign status (ACTIVE, PAUSED, DELETED, ARCHIVED)
 */
const AdCampaign = model.define("AdCampaign", {
  id: model.id().primaryKey(),
  
  // Meta identifiers
  meta_campaign_id: model.text(),
  name: model.text().searchable(),
  
  // Campaign config
  objective: model.enum([
    "OUTCOME_AWARENESS",
    "OUTCOME_ENGAGEMENT",
    "OUTCOME_LEADS",
    "OUTCOME_SALES",
    "OUTCOME_TRAFFIC",
    "OUTCOME_APP_PROMOTION",
    "LINK_CLICKS",
    "CONVERSIONS",
    "LEAD_GENERATION",
    "MESSAGES",
    "VIDEO_VIEWS",
    "BRAND_AWARENESS",
    "REACH",
    "POST_ENGAGEMENT",
    "PAGE_LIKES",
    "OTHER"
  ]).default("OTHER"),
  
  status: model.enum(["ACTIVE", "PAUSED", "DELETED", "ARCHIVED"]).default("PAUSED"),
  effective_status: model.text().nullable(), // Meta's computed status
  configured_status: model.text().nullable(),
  
  // Budget
  buying_type: model.enum(["AUCTION", "RESERVED"]).default("AUCTION"),
  daily_budget: model.bigNumber().nullable(),
  lifetime_budget: model.bigNumber().nullable(),
  budget_remaining: model.bigNumber().nullable(),
  
  // Special ad categories
  special_ad_categories: model.json().nullable(), // Array of categories
  
  // Schedule
  start_time: model.dateTime().nullable(),
  stop_time: model.dateTime().nullable(),
  
  // Performance metrics (synced from insights)
  impressions: model.bigNumber().default(0),
  clicks: model.bigNumber().default(0),
  spend: model.bigNumber().default(0),
  reach: model.bigNumber().default(0),
  leads: model.bigNumber().default(0),
  conversions: model.bigNumber().default(0),
  
  // Cost metrics
  cpc: model.float().nullable(), // Cost per click
  cpm: model.float().nullable(), // Cost per 1000 impressions
  ctr: model.float().nullable(), // Click-through rate
  cost_per_lead: model.float().nullable(),
  
  // Sync
  last_synced_at: model.dateTime().nullable(),
  
  // Relationships
  ad_account: model.belongsTo(() => AdAccount, { mappedBy: "campaigns" }),
  ad_sets: model.hasMany(() => AdSet, { mappedBy: "campaign" }),
  insights: model.hasMany(() => AdInsights, { mappedBy: "campaign" }),
  
  // Additional metadata
  metadata: model.json().nullable(),
})

export default AdCampaign
