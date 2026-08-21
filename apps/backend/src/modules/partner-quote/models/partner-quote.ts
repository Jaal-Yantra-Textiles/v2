import { model } from "@medusajs/framework/utils"

import PartnerQuoteLine from "./partner-quote-line"

/**
 * A shareable B2B quote: a partner mints a link, a business buyer opens it and
 * sees tier prices + spec + live landed cost for their quantities and
 * destination (EPIC #1389).
 *
 * ## A quote is a BASKET, not a line
 *
 * Lines live on `partner_quote_line`. A single-product quote is simply a
 * one-line quote, so nothing about that case is special-cased.
 *
 * 🔑 **Freight is on the quote, never on a line.** A multi-product quote ships
 * as ONE consignment, so the lane is quoted once against the summed weight.
 * Per-line freight would charge the buyer for several deliveries they are not
 * getting, and at bulk quantities that error is not small.
 *
 * ## The one rule this model exists to enforce
 *
 * **Nothing frozen here ever prices a cart.** The `quoted_*` columns are
 * evidence of what we told this buyer at mint time — display-only, so the page
 * can show "quoted vs live" honestly. The cart prices itself, which is also the
 * only path that gets tiers right: `variant.calculated_price` is the QUANTITY-1
 * price on every `/store/*` route, because only the cart sets
 * `context.quantity`. A "price at 500" rendered from a product payload is
 * silently the price at 1.
 *
 * ## Token handling follows `designer-invite`
 *
 * The raw token lives only in the URL and is returned once at mint. We persist
 * `token_hash` (sha256) so a DB read cannot reconstruct a working link. Unlike
 * an invite, a quote is deliberately **multi-view** — forwarding to procurement
 * is the use case, not an abuse of it — so there is no single-use flag and no
 * email lock. It stays revocable, and it expires.
 *
 * Expiry is derived at read time from `expires_at`; there is no cron sweeper,
 * so a row is never silently mutated behind the partner's back.
 */
const PartnerQuote = model.define("partner_quote", {
  id: model.id().primaryKey(),

  // ===== Ownership ========================================================
  // Plain text ids; relationships are managed via module links.
  partner_id: model.text(),
  // The partner store whose domain builds the public URL. A quote product is
  // not on the core sales channel, so the link must be built from the
  // partner's own domain or the buyer lands on a 404.
  store_id: model.text().nullable(),

  // ===== What was quoted ==================================================
  // See `partner-quote-line.ts`. The basket is the child rows; nothing about
  // "which variant" or "how many" belongs here.
  lines: model.hasMany(() => PartnerQuoteLine, { mappedBy: "quote" }),

  // Destination for the freight leg. Kept as plain fields rather than an
  // address row: a quote destination is a rough "where to", not a shippable
  // address, and asking a buyer for line 1 before they have a price is a wall.
  destination_country_code: model.text(),
  destination_postal_code: model.text().nullable(),
  destination_city: model.text().nullable(),

  currency_code: model.text(),
  region_id: model.text().nullable(),

  // ===== Recipient (human-entered, so render with {{ }}, never {{{ }}}) ====
  recipient_name: model.text().nullable(),
  recipient_company: model.text().nullable(),
  email_sent_to: model.text().nullable(),
  partner_note: model.text().nullable(),

  // ===== Frozen at mint: evidence, never an input to pricing ==============
  // These are literally the live builder's output at mint time, so no second
  // pricing path exists that could disagree with the page.
  // Per-line money lives on the line. These are the basket totals: the sum of
  // the frozen line subtotals, the ONE freight leg, and the landed total.
  quoted_subtotal: model.bigNumber().nullable(),
  quoted_freight: model.bigNumber().nullable(),
  quoted_landed_total: model.bigNumber().nullable(),
  // Total consignment weight the frozen freight was quoted against. Which
  // LEVEL each line's weight came from is on the line, because a basket can
  // mix a variant-weighted item with a product-weighted one.
  quoted_weight_grams: model.number().nullable(),
  quoted_at: model.dateTime().nullable(),

  // ===== Token + lifecycle ================================================
  // sha256(raw). The raw token is returned once, at mint.
  token_hash: model.text().unique(),
  status: model.enum(["active", "revoked"]).default("active"),
  expires_at: model.dateTime().nullable(),

  // ===== Engagement (fire-and-forget; tracking must never 500 a buyer) =====
  viewed_at: model.dateTime().nullable(),
  last_viewed_at: model.dateTime().nullable(),
  view_count: model.number().default(0),

  created_by: model.text().nullable(),
  metadata: model.json().nullable(),
})

export default PartnerQuote
