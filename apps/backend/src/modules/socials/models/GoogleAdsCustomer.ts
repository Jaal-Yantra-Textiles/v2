import { model } from "@medusajs/framework/utils"
import SocialPlatform from "./SocialPlatform"
import GoogleAdsCampaign from "./GoogleAdsCampaign"

/**
 * GoogleAdsCustomer
 *
 * A connected Google Ads account (CID). Populated by the
 * sync-google-ads-campaigns workflow off the user's Google Ads bindings.
 *
 * Kept separate from the Meta-shaped `AdAccount` table — the two networks
 * have different IDs, currencies, and metric semantics, and forcing them
 * into one row was the kind of refactor we wanted to avoid for slice 1.
 */
const GoogleAdsCustomer = model.define("GoogleAdsCustomer", {
  id: model.id().primaryKey(),

  // Google Ads identifiers
  customer_id: model.text().searchable(), // 10-digit CID, e.g. "1234567890"
  resource_name: model.text().nullable(), // "customers/1234567890"
  descriptive_name: model.text().nullable(),

  // Account properties
  currency_code: model.text().nullable(),
  time_zone: model.text().nullable(),
  is_manager: model.boolean().default(false),
  is_test_account: model.boolean().default(false),

  // Sync metadata
  last_synced_at: model.dateTime().nullable(),
  sync_status: model
    .enum(["synced", "syncing", "error", "pending"])
    .default("pending"),
  sync_error: model.text().nullable(),

  // Source binding — kept as text (not FK) because bindings can be deleted
  // independently and we don't want a cascade to wipe the synced data.
  binding_id: model.text().nullable(),

  // Relationships
  platform: model.belongsTo(() => SocialPlatform, {
    mappedBy: "google_ads_customers",
  }),
  campaigns: model.hasMany(() => GoogleAdsCampaign, {
    mappedBy: "customer",
  }),
})
.indexes([
  {
    on: ["customer_id"],
    name: "idx_google_ads_customer_cid",
  },
])

export default GoogleAdsCustomer
