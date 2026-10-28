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

  /*
   * What choosing this value ADDS to the price (#2456). Null on both means a
   * free choice, which is every value written before this existed.
   *
   * `price_per_piece` rides on every unit of the line ("₹150 per apron for the
   * embroidery"). `setup_fee` is charged once per new design, not per piece:
   * the ₹500 digitising a customer's logo costs the embroiderer once, whether
   * they order 1 apron or 50. It is a separate cart line so the customer sees
   * it, and because the money is the supplier's, not our margin.
   *
   * Both are GST-INCLUSIVE, the way the product's own price is quoted, and
   * denominated in `price_currency_code`. A price with no currency is refused
   * at the door: a bare 500 is ₹500 on one storefront and €500 on another.
   */
  price_per_piece: model.bigNumber().nullable(),
  setup_fee: model.bigNumber().nullable(),
  price_currency_code: model.text().nullable(),

  option: model.belongsTo(() => ProductSpecOption, { mappedBy: "values" }),
})

export default ProductSpecOptionValue
