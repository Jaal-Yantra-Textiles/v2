import { model } from "@medusajs/framework/utils"
import ShareClass from "./share-class"
import Stake from "./stake"
import FundingRound from "./funding-round"
import CallForShares from "./call-for-shares"
import Document from "./document"

const CapTable = model.define("cap_table", {
  id: model.id().primaryKey(),

  company_id: model.text().searchable(),
  name: model.text().searchable(),

  status: model.enum(["draft", "active", "archived"]).default("draft"),

  total_shares_authorized: model.bigNumber().nullable(),
  total_shares_issued: model.bigNumber().nullable(),
  total_shares_outstanding: model.bigNumber().nullable(),

  fully_diluted_shares: model.bigNumber().nullable(),
  pre_money_valuation: model.bigNumber().nullable(),
  post_money_valuation: model.bigNumber().nullable(),

  currency_code: model.text().nullable(),

  share_classes: model.hasMany(() => ShareClass),
  stakes: model.hasMany(() => Stake),
  funding_rounds: model.hasMany(() => FundingRound),
  calls_for_shares: model.hasMany(() => CallForShares),
  documents: model.hasMany(() => Document),

  metadata: model.json().nullable(),
})

export default CapTable
