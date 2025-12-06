import { model } from "@medusajs/framework/utils"
import SocialPlatform from "./SocialPlatform"
import AdCampaign from "./AdCampaign"
import LeadForm from "./LeadForm"

/**
 * AdAccount (Meta Ad Account)
 * 
 * Represents a connected Meta (Facebook/Instagram) ad account.
 * Stores account details, spending info, and sync status.
 * 
 * @property meta_account_id - Meta's ad account ID (e.g., act_123456789)
 * @property status - Internal status (active, disabled, pending)
 * @property account_status - Meta's account status code
 */
const AdAccount = model.define("AdAccount", {
  id: model.id().primaryKey(),
  
  // Meta identifiers
  meta_account_id: model.text(),  // act_123456789
  name: model.text().searchable(),
  
  // Account details
  currency: model.text().default("USD"),
  timezone: model.text().nullable(),
  business_name: model.text().nullable(),
  business_id: model.text().nullable(),
  
  // Status
  status: model.enum(["active", "disabled", "pending", "error"]).default("active"),
  account_status: model.number().nullable(), // Meta's status code (1=active, 2=disabled, etc.)
  disable_reason: model.text().nullable(),
  
  // Spending
  amount_spent: model.bigNumber().default(0),
  spend_cap: model.bigNumber().nullable(),
  balance: model.bigNumber().nullable(),
  min_daily_budget: model.bigNumber().nullable(),
  
  // Sync metadata
  last_synced_at: model.dateTime().nullable(),
  sync_status: model.enum(["synced", "syncing", "error", "pending"]).default("pending"),
  sync_error: model.text().nullable(),
  
  // Relationships
  platform: model.belongsTo(() => SocialPlatform, { mappedBy: "ad_accounts" }),
  campaigns: model.hasMany(() => AdCampaign, { mappedBy: "ad_account" }),
  lead_forms: model.hasMany(() => LeadForm, { mappedBy: "ad_account" }),
  
  // Additional metadata
  metadata: model.json().nullable(),
})

export default AdAccount
