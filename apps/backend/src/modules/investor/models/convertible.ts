import { model } from "@medusajs/framework/utils"
import Investor from "./investor"
import CapTable from "./cap-table"
import Payment from "./payment"

/**
 * A convertible instrument — a SAFE or convertible note (#969 follow-up).
 *
 * Money invested NOW that converts to equity LATER (at the next priced round or
 * a liquidity event). Unlike a `stake`, the holder has **no shares yet** — they
 * hold a contractual right to future equity — so this is modelled as its own
 * instrument rather than shoehorned into the share-centric `stake`.
 *
 * "Value" reflected to the investor is derived, not stored as shares:
 *  - principal_amount           → cost basis (certain)
 *  - implied ownership          → post-money SAFE: principal / valuation_cap
 *  - implied current value      → implied ownership × current company valuation
 * On a priced round the instrument CONVERTS: a real `stake` is created, its id
 * recorded in `converted_stake_id`, and status flips to `converted`.
 */
const Convertible = model.define("convertible", {
  id: model.id().primaryKey(),

  investor: model.belongsTo(() => Investor, {
    mappedBy: "convertibles",
  }),
  cap_table: model.belongsTo(() => CapTable, {
    mappedBy: "convertibles",
  }),
  // Kept as a plain id (not a relation) to avoid widening the funding_round /
  // stake models; resolve separately when needed.
  funding_round_id: model.text().nullable(),

  instrument_type: model.enum(["safe", "convertible_note"]).default("safe"),

  // The cash invested — the one certain number.
  principal_amount: model.bigNumber(),
  currency_code: model.text().nullable(),

  // Conversion economics.
  valuation_cap: model.bigNumber().nullable(),
  discount_rate: model.number().nullable(), // 0..1 (e.g. 0.20 = 20%)
  safe_type: model.enum(["post_money", "pre_money"]).default("post_money"),
  mfn: model.boolean().default(false),
  pro_rata: model.boolean().default(false),

  // Convertible-note-only terms.
  interest_rate: model.number().nullable(), // 0..1 annual
  maturity_date: model.dateTime().nullable(),

  investment_date: model.dateTime().nullable(),

  status: model
    .enum(["outstanding", "converted", "redeemed", "cancelled", "expired"])
    .default("outstanding"),

  // Populated on conversion into equity.
  converted_stake_id: model.text().nullable(),
  conversion_date: model.dateTime().nullable(),
  conversion_price_per_share: model.bigNumber().nullable(),
  conversion_shares: model.bigNumber().nullable(),

  payments: model.hasMany(() => Payment),

  notes: model.text().nullable(),
  metadata: model.json().nullable(),
})

export default Convertible
