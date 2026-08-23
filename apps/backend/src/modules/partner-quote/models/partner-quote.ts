import { model } from "@medusajs/framework/utils"

import PartnerQuoteLine from "./partner-quote-line"
import PartnerQuoteEvent from "./partner-quote-event"

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
  /** Append-only activity. See partner-quote-event.ts. */
  events: model.hasMany(() => PartnerQuoteEvent, { mappedBy: "quote" }),

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
  /**
   * Tax as it stood at mint (#1439 S8).
   *
   * 🔴 Without these the tax was recomputed on every page load while the
   * subtotal and freight beside it stayed frozen, so a rate change moved the
   * tax on a quote already sent — and the quote silently disagreed with itself.
   * Freezing it is the same argument that froze the subtotal.
   *
   * All four are frozen together on purpose. `quoted_tax_total` alone is
   * ambiguous: a frozen `0` cannot say whether it means "zero-rated export, no
   * tax due" or "we could not work it out", and that distinction is the whole
   * reason `QuoteTax.status` exists. `quoted_tax_reason` preserves the sentence
   * the buyer was actually shown — on an export that sentence is the only place
   * they were told duty is theirs, which makes it evidence, not decoration.
   *
   * Null on every quote minted before S8. That is the honest answer for them:
   * those rows have no tax figure, and defaulting to 0 would retroactively
   * assert they were tax-free.
   */
  quoted_tax_total: model.bigNumber().nullable(),
  quoted_tax_inclusive: model.boolean().nullable(),
  quoted_tax_status: model.text().nullable(),
  quoted_tax_reason: model.text().nullable(),
  /**
   * The partner undertook to pay destination duty and import tax on this quote.
   *
   * 🔴 Per-quote, frozen, and never defaulted true. It is the one promise on
   * the buyer's page that software alone cannot keep: the shipment has to
   * actually clear DDP — by a carrier that supports it, or arranged by hand
   * until one does. A global setting would tell a buyer there is nothing to pay
   * on a shipment nobody arranged clearance for.
   */
  duties_prepaid: model.boolean().nullable(),
  /**
   * The customs duty WE undertook to pay on this quote, in the quote currency.
   *
   * 🔴 This exists because `duties_prepaid` on its own promised the buyer duty
   * was covered while adding NOTHING to the price — the partner absorbed an
   * amount nobody had worked out, silently, out of margin. Deriving it
   * automatically is blocked (138 HS-code gaps across 65 products, EU 2–14%
   * with possible GSP relief, and Shiprocket's `tariff` returns 0 pending
   * CSB-5 KYC), so until a carrier can price it the partner enters the number
   * and we honour that number by hand.
   *
   * Null means no duty figure — either not a DDP quote, or a legacy row minted
   * before this column. `0` is a real, deliberate answer: AI-ECTA makes Indian
   * textiles duty-free into Australia, and "we checked, it is nil" is a fact,
   * not a gap. `quoted_duty_basis` is what tells those two apart to a human,
   * which is why they freeze together.
   */
  quoted_duty_total: model.bigNumber().nullable(),
  /**
   * How that number was arrived at — "EU 12% ad valorem, HS 6304.92", "AI-ECTA
   * duty-free". Evidence, not decoration: it is the only record of WHY we
   * committed to a figure, and the person who later pays the customs invoice
   * is not the person who typed it.
   */
  quoted_duty_basis: model.text().nullable(),
  /**
   * The other two thirds of a DDP undertaking.
   *
   * 🔴 Duty is the SMALL half. DHL's landed-cost planner on a 70,000 INR
   * consignment to NL: duty 6,143 (8% of goods + freight), import VAT 17,416
   * (21% of goods + freight + duty), carrier duty-tax-paid fee 1,982. A partner
   * who reads "duty" and funds only the duty under-writes the promise by
   * roughly 19,400 — and the buyer never finds out, because we eat it.
   *
   * Three columns rather than one lump because a carrier's invoice arrives
   * months later itemised, and "which of the three was wrong" is the only
   * question worth being able to answer against it.
   */
  quoted_import_tax_total: model.bigNumber().nullable(),
  quoted_ddp_fee_total: model.bigNumber().nullable(),
  /**
   * The rates the amounts were derived from, frozen so the figure can be
   * re-derived rather than merely believed. Null on a lane priced by a flat
   * amount — a specific duty is charged per kilo and no percentage says it.
   */
  quoted_duty_rate: model.number().nullable(),
  quoted_import_tax_rate: model.number().nullable(),
  quoted_at: model.dateTime().nullable(),

  // ===== Buyer identity — the edges this quote's prices hang off ==========
  /**
   * 🔴 These are NOT metadata, and they used to be (#1440).
   *
   * The mint creates a customer, a customer group named for the buyer, and a
   * price list ruled on that group. Those three ids are what make the quoted
   * number the number the cart charges, and what a revoke has to delete.
   *
   * They lived in `metadata` json until #1440, which made the one query that
   * matters impossible: "what other active price lists does this buyer's group
   * already have?" A module service `list` cannot filter on a json key, so a
   * repeat quote silently STACKED a second price list on the same group and
   * core tie-broke on `amount ASC` — handing a re-quoted buyer the older,
   * cheaper prices (#1435). Columns, not a blob, is what makes supersede
   * possible at all.
   */
  customer_id: model.text().nullable(),
  // The index lives in the migration, not here — `.index()` is not available
  // after `.nullable()`, and this module follows the same convention as
  // `ai_usage`: indexes are maintained by the migrations.
  customer_group_id: model.text().nullable(),
  price_list_id: model.text().nullable(),

  // ===== Token + lifecycle ================================================
  // sha256(raw). The raw token is returned once, at mint.
  token_hash: model.text().unique(),
  /**
   * `superseded` means a NEWER quote to the same buyer replaced this one, and
   * this quote's price list has been expired so it can no longer price a cart.
   * It is deliberately distinct from `revoked`: nobody withdrew this quote, and
   * the buyer should be told a current one exists rather than that the partner
   * pulled the offer.
   */
  status: model.enum(["active", "revoked", "superseded"]).default("active"),
  expires_at: model.dateTime().nullable(),

  // ===== Engagement (fire-and-forget; tracking must never 500 a buyer) =====
  viewed_at: model.dateTime().nullable(),
  last_viewed_at: model.dateTime().nullable(),
  view_count: model.number().default(0),

  created_by: model.text().nullable(),
  /**
   * Genuinely incidental data only. The buyer identity ids that used to live
   * here are now columns above — see the note on `customer_id`. Nothing
   * load-bearing goes back in here.
   */
  metadata: model.json().nullable(),
})

export default PartnerQuote
