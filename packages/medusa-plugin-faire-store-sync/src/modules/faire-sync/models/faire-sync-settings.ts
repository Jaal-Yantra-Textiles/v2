import { model } from "@medusajs/framework/utils"

/**
 * Singleton settings row. Holds publish-readiness defaults plus the in-flight
 * OAuth `state` (keyed by it) so the callback can verify the round-trip.
 *
 * Faire-flavored readiness: connection, brand id, wholesale pricing strategy,
 * and shipping policy. Missing fields sync products as drafts rather than
 * publishing them.
 */
const FaireSyncSettings = model.define("faire_sync_settings", {
  id: model.id().primaryKey(),
  account_id: model.text().nullable(),
  default_brand_id: model.text().nullable(),
  default_wholesale_markup_percent: model.number().nullable(),
  default_min_order_quantity: model.number().default(1),
  default_lead_time_days: model.number().nullable(),
  default_shipping_policy_id: model.text().nullable(),
  default_category: model.text().nullable(),
  auto_publish: model.boolean().default(false),
  follow_product_status: model.boolean().default(true),
  pending_oauth: model.json().nullable(),
  // High-water mark for incremental order polling (Faire polls, not webhooks).
  last_order_sync_at: model.dateTime().nullable(),
})

export default FaireSyncSettings
