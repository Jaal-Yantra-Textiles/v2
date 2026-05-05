import { model } from "@medusajs/framework/utils"
import SocialPlatform from "./SocialPlatform"

/**
 * SocialPlatformBinding
 *
 * A binding hangs off one SocialPlatform connection (typically a Google
 * Business Manager-style row with category="google") and pins a specific
 * service + resource the operator wants to act on.
 *
 * One Google connection → many bindings:
 *   (merchant, merchant_id="123")
 *   (ads,       customer_id="456-789-0123")
 *   (search-console, site_url="https://shop.example.com/")
 *   (business-profile, location="accounts/X/locations/Y")
 *
 * Service-specific workflow tables (sync jobs, conversion uploads, etc.)
 * FK back here by binding_id, not by the parent platform — so a single
 * connection can drive multiple bound resources independently.
 *
 * @property service - Which Google API surface this binding targets
 * @property resource_id - Google's natural key for the bound resource
 *                         (merchant_id / customer_id / siteUrl / location resource name)
 * @property resource_label - Human-readable label cached from Google for the picker UI
 * @property settings - Per-binding config that doesn't fit the model columns
 *                      (e.g. data_source_name, login_customer_id, feed_label, content_language)
 */
const SocialPlatformBinding = model.define("SocialPlatformBinding", {
  id: model.id().primaryKey(),

  service: model
    .enum(["merchant", "ads", "search-console", "business-profile"]),

  resource_id: model.text(),
  resource_label: model.text().nullable(),

  status: model
    .enum(["active", "paused", "error", "pending"])
    .default("active"),

  last_synced_at: model.dateTime().nullable(),
  last_error: model.text().nullable(),

  settings: model.json().nullable(),
  metadata: model.json().nullable(),

  platform: model.belongsTo(() => SocialPlatform, { mappedBy: "bindings" }),
}).indexes([
  {
    on: ["platform_id", "service", "resource_id"],
    unique: true,
  },
  {
    on: ["service", "status"],
  },
])

export default SocialPlatformBinding
