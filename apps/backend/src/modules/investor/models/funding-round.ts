import { model } from "@medusajs/framework/utils"
import CapTable from "./cap-table"
import Stake from "./stake"

const FundingRound = model.define("funding_round", {
  id: model.id().primaryKey(),

  cap_table: model.belongsTo(() => CapTable, {
    mappedBy: "funding_rounds",
  }),

  name: model.text().searchable(),
  round_type: model.enum([
    "pre_seed",
    "seed",
    "series_a",
    "series_b",
    "series_c",
    "series_d_plus",
    "bridge",
    "debt",
    "grant",
    "safe",
  ]).default("seed"),

  // What participating in this round issues. `equity` → a Stake (shares);
  // `safe` / `convertible_note` → a Convertible (money now, equity later).
  instrument_type: model.enum(["equity", "safe", "convertible_note"]).default("equity"),

  status: model.enum(["planned", "open", "closing", "closed", "cancelled"]).default("planned"),

  target_amount: model.bigNumber().nullable(),
  raised_amount: model.bigNumber().nullable(),
  pre_money_valuation: model.bigNumber().nullable(),
  post_money_valuation: model.bigNumber().nullable(),

  price_per_share: model.bigNumber().nullable(),
  shares_offered: model.bigNumber().nullable(),

  // SAFE / convertible round terms (applied to Convertibles created on participate).
  valuation_cap: model.bigNumber().nullable(),
  discount_rate: model.number().nullable(),
  safe_type: model.enum(["post_money", "pre_money"]).nullable(),

  open_date: model.dateTime().nullable(),
  close_date: model.dateTime().nullable(),

  lead_investor: model.text().nullable(),

  stakes: model.hasMany(() => Stake),

  metadata: model.json().nullable(),
})

export default FundingRound
