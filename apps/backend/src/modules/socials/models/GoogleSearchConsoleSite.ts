import { model } from "@medusajs/framework/utils"
import SocialPlatform from "./SocialPlatform"
import GoogleSearchConsoleInsights from "./GoogleSearchConsoleInsights"

/**
 * GoogleSearchConsoleSite
 *
 * A verified Google Search Console property bound to a SocialPlatform (the
 * Google Business Manager connection). One row per (platform, site_url) we
 * have visibility into via Search Console.
 *
 * site_url comes back from Search Console in one of two forms:
 *   - "https://example.com/"        — URL-prefix property (scheme + host + /)
 *   - "sc-domain:example.com"       — Domain property (covers all subdomains
 *                                     and protocols of example.com)
 *
 * We store whichever shape Google returned without normalizing — when we
 * later resolve a website row to a bound property, the resolver matches
 * across both forms in code.
 */
const GoogleSearchConsoleSite = model.define("GoogleSearchConsoleSite", {
  id: model.id().primaryKey(),

  site_url: model.text().searchable(),
  permission_level: model.text().nullable(), // siteOwner | siteFullUser | siteRestrictedUser

  // Sync metadata
  last_synced_at: model.dateTime().nullable(),
  sync_status: model
    .enum(["synced", "syncing", "error", "pending"])
    .default("pending"),
  sync_error: model.text().nullable(),

  // Source binding — text (not FK) so deleting a binding doesn't cascade
  // and wipe synced data. Matches the GoogleAdsCustomer pattern.
  binding_id: model.text().nullable(),

  platform: model.belongsTo(() => SocialPlatform, {
    mappedBy: "google_search_console_sites",
  }),
  insights: model.hasMany(() => GoogleSearchConsoleInsights, {
    mappedBy: "site",
  }),
}).indexes([
  {
    on: ["site_url"],
    name: "idx_google_search_console_site_url",
  },
])

export default GoogleSearchConsoleSite
