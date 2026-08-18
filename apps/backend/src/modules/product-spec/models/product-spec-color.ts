import { model } from "@medusajs/framework/utils"
import ProductSpec from "./product-spec"

/**
 * One entry in a product spec's colour palette (#1342).
 *
 * Rows rather than a json blob, deliberately mirroring `DesignColor` (name +
 * hex + order) so a palette means the same thing on a design and on a product,
 * and so a single colourway can later be pointed at from an order line without
 * having to name an array index.
 */
const ProductSpecColor = model.define("product_spec_color", {
  id: model.id().primaryKey(),

  // The partner's name for the colour, in their own vocabulary ("Kashmiri
  // walnut", "undyed"). This is what the customer chooses by.
  name: model.text(),

  // "#RRGGBB", normalised and validated on write. Nullable because an undyed or
  // natural shade is a real palette entry that no hex describes honestly.
  hex_code: model.text().nullable(),

  // What this colour is for, when it isn't the whole cloth ("border only",
  // "extra weft motif").
  usage_notes: model.text().nullable(),

  // Display order in the palette. The partner's ordering is meaningful — the
  // first entry usually reads as the default.
  order: model.number().default(0),

  // Whether this colour can currently be ordered. Kept rather than deleted so a
  // colour that is temporarily out of yarn keeps its identity (and any order
  // that already referenced it still resolves).
  available: model.boolean().default(true),

  spec: model.belongsTo(() => ProductSpec, { mappedBy: "colors" }),
})

export default ProductSpecColor
