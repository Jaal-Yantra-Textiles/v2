import { model } from "@medusajs/framework/utils"
import GoogleAdsAdGroup from "./GoogleAdsAdGroup"

/**
 * GoogleAdsAd
 *
 * Individual ad (creative) under a Google Ads ad group. Google's
 * `ad_group_ad` resource wraps both the placement (ad_group_ad.status,
 * resource_name) and the creative itself (ad_group_ad.ad.*). We flatten
 * the most useful creative fields here so the picker UI can render
 * thumbnails / headlines without joining to a separate creative table.
 *
 * Parallel to Meta's `Ad` model — kept split because the type enums
 * (RESPONSIVE_SEARCH_AD vs Meta's CAROUSEL/COLLECTION/etc.) don't overlap
 * and would force a constant per-network switch in the UI otherwise.
 */
const GoogleAdsAd = model.define("GoogleAdsAd", {
  id: model.id().primaryKey(),

  // Google identifiers — ad_group_ad.ad.id is the stable creative id;
  // ad_group_ad.resource_name is the placement-level resource path.
  ad_id: model.text().searchable(),
  resource_name: model.text().nullable(), // "customers/{cid}/adGroupAds/{ag}~{ad}"
  ad_resource_name: model.text().nullable(), // "customers/{cid}/ads/{ad}"

  name: model.text().searchable().nullable(),

  // Placement status (ad_group_ad.status) and ad-level status
  // (ad_group_ad.ad.status). They're separate in GAQL — usually equal,
  // but a paused ad inside an enabled placement is valid.
  status: model
    .enum(["UNSPECIFIED", "UNKNOWN", "ENABLED", "PAUSED", "REMOVED"])
    .default("UNSPECIFIED"),
  ad_status: model
    .enum(["UNSPECIFIED", "UNKNOWN", "ENABLED", "PAUSED", "REMOVED"])
    .default("UNSPECIFIED"),

  // Creative shape — covers the union of all ad types we sync today.
  type: model.text().nullable(), // RESPONSIVE_SEARCH_AD, EXPANDED_TEXT_AD, IMAGE_AD, VIDEO_AD, RESPONSIVE_DISPLAY_AD, ...
  display_url: model.text().nullable(),

  // URL targets are arrays in GAQL even for single-URL ads.
  final_urls: model.json().nullable(),
  final_mobile_urls: model.json().nullable(),

  // RSAs and RDAs store asset arrays for headlines/descriptions; ETAs
  // and other legacy types fill these into the first slot only.
  headlines: model.json().nullable(),
  descriptions: model.json().nullable(),

  // Image / video creative
  image_url: model.text().nullable(),
  video_id: model.text().nullable(),

  // Latest metrics (last GAQL pull). Time-series detail lives in
  // GoogleAdsInsights.
  impressions: model.bigNumber().default(0),
  clicks: model.bigNumber().default(0),
  conversions: model.bigNumber().default(0),
  cost_micros: model.bigNumber().default(0),

  last_synced_at: model.dateTime().nullable(),

  ad_group: model.belongsTo(() => GoogleAdsAdGroup, {
    mappedBy: "ads",
  }),

  metadata: model.json().nullable(),
}).indexes([
  {
    on: ["ad_id"],
    name: "idx_google_ads_ad_id",
  },
])

export default GoogleAdsAd
