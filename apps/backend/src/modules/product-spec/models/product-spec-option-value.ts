import { model } from "@medusajs/framework/utils"
import ProductSpecOption from "./product-spec-option"

/**
 * One selectable value on a partner-defined spec option ("Kashida — cuff and
 * pallu", "None").
 *
 * Rows rather than a string array on the option, for the reason
 * `ProductSpecColor` is rows: a value needs to be switchable OFF without being
 * deleted. A partner whose embroiderer is booked for a month turns the value
 * unavailable; deleting it would break every order that already named it and
 * would lose the row's identity when it comes back.
 */
const ProductSpecOptionValue = model.define("product_spec_option_value", {
  id: model.id().primaryKey(),

  // What the customer picks by, and what is snapshotted onto the line item.
  label: model.text(),

  // Detail shown beside the value — a lead-time hint, a caveat.
  note: model.text().nullable(),

  order: model.number().default(0),

  // Orderable right now. Filtered out of the public read and rejected by the
  // cart route, the same closed-set rule the palette already enforces.
  available: model.boolean().default(true),

  option: model.belongsTo(() => ProductSpecOption, { mappedBy: "values" }),
})

export default ProductSpecOptionValue
