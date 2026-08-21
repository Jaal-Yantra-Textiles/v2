import { model } from "@medusajs/framework/utils"

import PartnerQuote from "./partner-quote"

/**
 * The quote's activity log (#1389 S5).
 *
 * ## Why a log and not a set of columns
 *
 * The quote already carries `viewed_at`, `last_viewed_at` and `view_count` —
 * three columns that answer "was it looked at" and nothing else. They cannot
 * say when it was revoked, who revoked it, whether an admin minted it on the
 * partner's behalf, or that the buyer dialled the quantities before deciding.
 * Those are the questions asked when a buyer disputes a price, and a counter
 * cannot answer any of them.
 *
 * ## An append-only record, deliberately
 *
 * Nothing updates or deletes a row here. A log that can be rewritten is not
 * evidence, and the whole reason this exists is that a quote is a commercial
 * commitment somebody may later argue about.
 *
 * 🔑 `actor_type` distinguishes the three parties that can touch a quote — the
 * partner, an admin acting on their behalf, and the buyer holding the token.
 * Without it an admin-minted quote is indistinguishable from one the partner
 * made themselves, which is exactly the question asked first when a price is
 * challenged.
 */
const PartnerQuoteEvent = model.define("partner_quote_event", {
  id: model.id().primaryKey(),
  quote: model.belongsTo(() => PartnerQuote, { mappedBy: "events" }),

  /**
   * What happened. Text rather than an enum: an event type this log has never
   * seen must still be recordable — refusing to log something because the
   * vocabulary is stale is how activity goes missing precisely when it is new.
   */
  type: model.text(),

  /** "partner" | "admin" | "buyer" | "system". */
  actor_type: model.text(),
  /** Null for the buyer, who is only ever a token holder. */
  actor_id: model.text().nullable(),

  /** Human-readable line for the timeline. */
  message: model.text().nullable(),
  /** Event-shaped extras — dialled quantities, deleted price list id, etc. */
  data: model.json().nullable(),
})

export default PartnerQuoteEvent
