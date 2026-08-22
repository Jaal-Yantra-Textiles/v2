import { model } from "@medusajs/framework/utils"

import PartnerQuote from "./partner-quote"

/**
 * One product in a quoted basket (#1389).
 *
 * A partner builds a basket — "500 of the plain pashmina, 200 of the striped" —
 * and the buyer moves each line's quantity. A single-product quote is a
 * one-line quote; there is no separate shape for it.
 *
 * ## What is on the line, and what deliberately is not
 *
 * The line owns **price**: the tier unit amount at ITS quantity, and the
 * subtotal that follows. It does NOT own freight. The basket ships as one
 * consignment, so the lane is quoted once, on the quote, against the summed
 * weight — see `partner-quote.ts`.
 *
 * `quoted_weight_source` IS per line, because a basket can mix a properly
 * variant-weighted item with one falling back to its product weight. A
 * declared product weight over-quotes a lighter variant (115 g against a real
 * 105 g), and at 200 units that can cross a carrier slab, so the provenance
 * has to travel at the resolution it actually varies at.
 *
 * Same rule as the parent: **nothing frozen here ever prices a cart.** These
 * are evidence of what this buyer was told.
 */
const PartnerQuoteLine = model.define("partner_quote_line", {
  id: model.id().primaryKey(),

  quote: model.belongsTo(() => PartnerQuote, { mappedBy: "lines" }),

  variant_id: model.text(),
  product_id: model.text().nullable(),
  quantity: model.number(),

  /** Basket order as the partner arranged it. Presentation, not identity. */
  position: model.number().default(0),

  // ===== Frozen at mint ====================================================
  // The live builder's output for THIS line at mint time.
  quoted_unit_amount: model.bigNumber().nullable(),
  quoted_subtotal: model.bigNumber().nullable(),
  /** Unit weight used, and which level it came from. See the header. */
  quoted_unit_weight_grams: model.number().nullable(),
  quoted_weight_source: model.enum(["variant", "product"]).nullable(),

  // ===== The trade price, and how it was arrived at (#1439 S7) =============
  /**
   * A B2B buyer does not pay retail. `quoted_unit_amount` above is the FINAL
   * number either way — these columns record how it was reached, so the quote
   * is auditable rather than reverse-engineered later.
   *
   * 🔑 `override_input_amount` is what the partner actually TYPED, before any
   * conversion, and `override_input_currency_code` is the partner store's
   * default currency — the one they think in. `override_fx_rate` is the rate
   * applied at mint. Without all three, a quoted number cannot be reproduced
   * once the rate has moved, and an unreproducible number is not evidence.
   *
   * Null on every line that was quoted at its catalog price, which is most of
   * them.
   */
  override_kind: model
    .enum(["discount_percent", "override_unit_amount"])
    .nullable(),
  override_input_amount: model.bigNumber().nullable(),
  /** Null for a percentage — a percentage has no currency. */
  override_input_currency_code: model.text().nullable(),
  /** 1 for a percentage and for a same-currency override. */
  override_fx_rate: model.float().nullable(),

  /** Partner's per-line note to the buyer. Human-entered: render with {{ }}. */
  note: model.text().nullable(),

  metadata: model.json().nullable(),
})

export default PartnerQuoteLine
