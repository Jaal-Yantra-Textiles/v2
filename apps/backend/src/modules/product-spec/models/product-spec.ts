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

  /**
   * The FINISHED piece's size (#1510 follow-up — "which size am I buying?").
   *
   * 🔴 Not a weave param. `validateWeaveParams` rejects any key the chosen
   * technique does not list and refuses params outright without a technique, so
   * a shared "size" param would either have to be bolted onto all eleven
   * techniques or would be unavailable to every product that has no weave at
   * all. Size belongs to the piece, not to how it was woven.
   *
   * Centimetres, always, because a quote crosses borders and a unitless number
   * beside a price is how a buyer orders the wrong thing. The storefront
   * converts for display if it ever needs to; the stored fact does not move.
   *
   * `loom_width_cm` is a different measurement and must not be confused with
   * this one: that is the width of the cloth ON the loom, before it is cut,
   * hemmed and washed.
   */
  finished_length_cm: model.number().nullable(),
  finished_width_cm: model.number().nullable(),

  /**
   * What the partner CALLS that size — "Stole", "Full shawl", "King".
   *
   * Mirrors `weave_label` over `weave_technique`: the name the trade uses,
   * shown alongside the measurement rather than instead of it. A buyer who
   * knows "Stole" does not want to decode 200 × 70, and a buyer who does not
   * know the word needs the numbers.
   */
  size_label: model.text().nullable(),

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
