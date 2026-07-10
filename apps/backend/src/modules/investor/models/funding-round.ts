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
  ]).default("seed"),

  status: model.enum(["planned", "open", "closing", "closed", "cancelled"]).default("planned"),

  target_amount: model.bigNumber().nullable(),
  raised_amount: model.bigNumber().nullable(),
  pre_money_valuation: model.bigNumber().nullable(),
  post_money_valuation: model.bigNumber().nullable(),

  price_per_share: model.bigNumber().nullable(),
  shares_offered: model.bigNumber().nullable(),

  open_date: model.dateTime().nullable(),
  close_date: model.dateTime().nullable(),

  lead_investor: model.text().nullable(),

  stakes: model.hasMany(() => Stake),

  metadata: model.json().nullable(),
})

export default FundingRound
