import { model } from "@medusajs/framework/utils"
import CapTable from "./cap-table"
import Payment from "./payment"
import Document from "./document"

const CallForShares = model.define("call_for_shares", {
  id: model.id().primaryKey(),

  cap_table: model.belongsTo(() => CapTable, {
    mappedBy: "calls_for_shares",
  }),

  name: model.text().searchable(),
  call_type: model.enum([
    "rights_issue",
    "follow_on",
    "capital_call",
    "top_up",
  ]).default("rights_issue"),

  status: model.enum(["draft", "announced", "open", "closing", "closed", "cancelled"]).default("draft"),

  shares_offered: model.bigNumber().nullable(),
  price_per_share: model.bigNumber().nullable(),
  target_amount: model.bigNumber().nullable(),
  raised_amount: model.bigNumber().nullable(),

  open_date: model.dateTime().nullable(),
  close_date: model.dateTime().nullable(),
  record_date: model.dateTime().nullable(),

  ratio: model.text().nullable(),

  terms: model.text().nullable(),

  payments: model.hasMany(() => Payment),
  documents: model.hasMany(() => Document),

  metadata: model.json().nullable(),
})

export default CallForShares
