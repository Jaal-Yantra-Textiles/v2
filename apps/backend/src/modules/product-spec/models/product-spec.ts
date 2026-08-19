import { model } from "@medusajs/framework/utils"
import ProductSpecColor from "./product-spec-color"
import ProductSpecField from "./product-spec-field"
import ProductSpecOption from "./product-spec-option"

/**
 * Partner-authored production spec for a product (#1342).
 *
 * What a partner agrees to make BEFORE taking a custom order: the weave, its
 * measurable parameters, the colour palette it may be made in, and any spec the
 * catalog cannot express.
 *
 * Typed columns in a linked module — NOT product metadata — for the reason
 * `artisan-product-detail` states: partner product updates write the whole
 * metadata blob (`api/partners/stores/[id]/products/[productId]/route.ts` calls
 * `updateProducts` with the raw body), so anything kept there is one unrelated
 * save away from being erased. A spec a customer ordered against must not be
 * erasable that way.
 *
 * One row per product (`product_id` unique). Linked to the core Product via
 * `links/product-spec.ts`.
 */
const ProductSpec = model.define("product_spec", {
  id: model.id().primaryKey(),

  // The product this spec belongs to. Unique — one spec row per product.
  product_id: model.text().unique(),

  // Weave technique slug from `weaving-techniques.ts` (e.g. "pashmina-plain",
  // "ikat"). Nullable: a partner may want only a palette, or only free fields.
  weave_technique: model.text().nullable(),

  // The partner's own words for the weave, shown in preference to the catalog
  // label when set ("Kani, 3-colour, Srinagar loom").
  weave_label: model.text().nullable(),

  // Measured parameters, keyed by `WeaveParamDef.key` and validated against the
  // chosen technique's ranges before write (see the upsert workflow). A json
  // column rather than rows because the KEYS are owned by the catalog, not by
  // the partner — the open-ended half lives in `fields` below.
  params: model.json().nullable(),

  // Finishing/care steps that travel with the cloth ("hand wash cold",
  // "dry flat"). Seeded from the technique, then edited freely.
  finishes: model.json().nullable(),

  // Free-form notes for the workshop — anything that is guidance rather than
  // data ("warp tension eases in monsoon; allow an extra day").
  notes: model.text().nullable(),

  // Whether this spec is offered for custom orders. Off by default so a
  // half-written spec is never presented as something a customer can order.
  accepting_custom_orders: model.boolean().default(false),

  // Minimum lead time the partner needs for a custom order against this spec,
  // in days. Distinct from ArtisanProductDetail.lead_time_days, which describes
  // the ready-made product; a bespoke colourway usually takes longer.
  custom_order_lead_time_days: model.number().nullable(),

  colors: model.hasMany(() => ProductSpecColor, { mappedBy: "spec" }),
  options: model.hasMany(() => ProductSpecOption, { mappedBy: "spec" }),
  fields: model.hasMany(() => ProductSpecField, { mappedBy: "spec" }),
})

export default ProductSpec
