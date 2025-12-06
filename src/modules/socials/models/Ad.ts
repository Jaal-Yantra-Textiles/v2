import { model } from "@medusajs/framework/utils"
import AdSet from "./AdSet"

/**
 * Ad (Meta Ad)
 * 
 * Represents an individual Meta ad.
 * Ads contain the creative and are what users actually see.
 * 
 * @property meta_ad_id - Meta's ad ID
 * @property creative_id - Meta's ad creative ID
 * @property preview_url - URL to preview the ad
 */
const Ad = model.define("Ad", {
  id: model.id().primaryKey(),
  
  // Meta identifiers
  meta_ad_id: model.text(),
  name: model.text().searchable(),
  
  // Status
  status: model.enum(["ACTIVE", "PAUSED", "DELETED", "ARCHIVED"]).default("PAUSED"),
  effective_status: model.text().nullable(),
  configured_status: model.text().nullable(),
  
  // Creative
  creative_id: model.text().nullable(),
  creative: model.json().nullable(), // Full creative object
  preview_url: model.text().nullable(),
  
  // Ad content (extracted from creative for easy access)
  headline: model.text().nullable(),
  body: model.text().nullable(),
  call_to_action: model.text().nullable(),
  link_url: model.text().nullable(),
  image_url: model.text().nullable(),
  video_url: model.text().nullable(),
  
  // Performance metrics
  impressions: model.bigNumber().default(0),
  clicks: model.bigNumber().default(0),
  spend: model.bigNumber().default(0),
  reach: model.bigNumber().default(0),
  leads: model.bigNumber().default(0),
  conversions: model.bigNumber().default(0),
  
  // Cost metrics
  cpc: model.float().nullable(),
  cpm: model.float().nullable(),
  ctr: model.float().nullable(),
  cost_per_lead: model.float().nullable(),
  
  // Engagement
  likes: model.bigNumber().default(0),
  comments: model.bigNumber().default(0),
  shares: model.bigNumber().default(0),
  
  // Sync
  last_synced_at: model.dateTime().nullable(),
  
  // Relationships
  ad_set: model.belongsTo(() => AdSet, { mappedBy: "ads" }),
  
  // Additional metadata
  metadata: model.json().nullable(),
})

export default Ad
