import { model } from "@medusajs/framework/utils"

/**
 * Artisan product detail (issue #859 S3 / #862).
 *
 * Partner-editable, per-product "made-to-order & maker story" attributes for
 * the Airbnb-style artisan flow. One row per product (`product_id` unique).
 * Typed columns — NOT a metadata blob — because these fields are surfaced on
 * the storefront and enforced at checkout (min order quantity), so they must
 * survive Medusa's whole-blob metadata overwrites
 * (see feedback_no_critical_data_in_metadata).
 *
 * Linked to the core Product via `links/product-artisan-detail.ts`.
 */
const ArtisanProductDetail = model.define("artisan_product_detail", {
  id: model.id().primaryKey(),

  // The product this detail belongs to. Unique — one detail row per product.
  product_id: model.text().unique(),

  // When true the storefront shows the made-to-order treatment (no live
  // stock gate — the item is produced on demand once ordered).
  made_to_order: model.boolean().default(false),

  // Expected preparation time in days. Rendered on the storefront as an
  // approximate "~X weeks to prepare" when `lead_time_label` is not set.
  lead_time_days: model.number().nullable(),

  // Free-form lead-time copy that, when present, overrides the derived
  // "~X weeks" phrasing (e.g. "takes a few weeks", "made to your measurements").
  lead_time_label: model.text().nullable(),

  // Minimum quantity the customer must order. Enforced in add-to-cart.
  min_order_quantity: model.number().nullable(),

  // The maker / provenance prose shown on the product page (who made it,
  // where, and how). Free-form partner-authored text.
  maker_story: model.text().nullable(),
})

export default ArtisanProductDetail
