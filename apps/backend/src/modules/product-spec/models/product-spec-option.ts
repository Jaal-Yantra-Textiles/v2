import { model } from "@medusajs/framework/utils"
import ProductSpec from "./product-spec"
import ProductSpecOptionValue from "./product-spec-option-value"

/**
 * A partner-defined CHOICE on a made-to-order spec — "Embroidery", "Border",
 * "Pallu finish" — with the values a customer may pick from.
 *
 * The third kind of thing a spec holds, and the one the first cut was missing.
 * `ProductSpecColor` is a palette (one axis, always colours) and
 * `ProductSpecField` is a fixed FACT the partner states about the cloth. Neither
 * can express "the customer picks one of these", which is what a made-to-order
 * piece is mostly made of. Adding an `embroidery` column instead would have
 * bought one word and left the next one — border, tassel, monogram — to another
 * migration; the partner names the axis here.
 *
 * Why it is not a product option/variant: a variant is a stocked, priced thing.
 * These are choices on a piece that does not exist yet, so multiplying them into
 * the variant matrix invents SKUs nobody will ever hold. Moving "Color Pattern"
 * off the variant axis of `ikat-grid-patterns-blue-yellow` is exactly this — 3
 * patterns × 2 spins = 6 phantom variants where 2 real ones will do.
 */
const ProductSpecOption = model.define("product_spec_option", {
  id: model.id().primaryKey(),

  // Machine key, normalised on write ("embroidery", "border_finish"). Same
  // reason `ProductSpecField.key` is normalised: these are meant to be compared
  // across products, and no two partners capitalise the same way.
  key: model.text(),

  // What the customer sees on the product page ("Embroidery").
  label: model.text().nullable(),

  // One line under the label, when the choice needs explaining ("Kashida is
  // worked by hand and adds about two weeks").
  help_text: model.text().nullable(),

  // Whether a customer MUST choose before adding to cart. False lets a group be
  // a genuine add-on that can be left off; true is for an axis that has no
  // sensible default, which is what "Color Pattern" becomes once it stops
  // being a variant.
  required: model.boolean().default(false),

  order: model.number().default(0),

  values: model.hasMany(() => ProductSpecOptionValue, { mappedBy: "option" }),
  spec: model.belongsTo(() => ProductSpec, { mappedBy: "options" }),
})

export default ProductSpecOption
