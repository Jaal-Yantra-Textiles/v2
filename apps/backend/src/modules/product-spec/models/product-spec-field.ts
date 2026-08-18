import { model } from "@medusajs/framework/utils"
import ProductSpec from "./product-spec"

/**
 * A partner-defined spec field the weaving catalog does not cover (#1342).
 *
 * The escape hatch that keeps the catalog honest: rather than growing
 * `weaving-techniques.ts` for every regional term, a partner writes the field
 * themselves. Rows rather than a json blob so the same key can later be
 * aggregated across products ("show me everything with a `pallu` spec").
 *
 * Mirrors the raw-material admin form's `extra[]` pattern, which is the
 * established way this codebase lets a user add a spec key it never planned for.
 */
const ProductSpecField = model.define("product_spec_field", {
  id: model.id().primaryKey(),

  // Machine-ish key, normalised on write (lowercase, underscores): "pallu_type".
  key: model.text(),

  // What the partner sees — free-form and translatable-in-spirit ("Pallu type").
  label: model.text().nullable(),

  // The value, always stored as text. Not typed as a number even when it looks
  // like one: "2.5 inches", "80/2", and "approx 40" are all real answers a
  // weaver gives, and coercing them loses more than it gains.
  value: model.text().nullable(),

  order: model.number().default(0),

  spec: model.belongsTo(() => ProductSpec, { mappedBy: "fields" }),
})

export default ProductSpecField
