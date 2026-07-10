import { model } from "@medusajs/framework/utils"
import Investor from "./investor"
import CapTable from "./cap-table"
import ShareClass from "./share-class"
import FundingRound from "./funding-round"
import Payment from "./payment"

const Stake = model.define("stake", {
  id: model.id().primaryKey(),

  investor: model.belongsTo(() => Investor, {
    mappedBy: "stakes",
  }),
  cap_table: model.belongsTo(() => CapTable, {
    mappedBy: "stakes",
  }),
  share_class: model.belongsTo(() => ShareClass, {
    mappedBy: "stakes",
    optional: true,
  }),
  funding_round: model.belongsTo(() => FundingRound, {
    mappedBy: "stakes",
    optional: true,
  }),

  number_of_shares: model.bigNumber(),
  share_price: model.bigNumber().nullable(),
  total_invested: model.bigNumber().nullable(),

  ownership_percentage: model.number().nullable(),
  vesting_start_date: model.dateTime().nullable(),
  vesting_schedule: model.text().nullable(),
  vested_shares: model.bigNumber().nullable(),

  certificate_number: model.text().nullable(),
  issue_date: model.dateTime().nullable(),
  transfer_status: model.enum([
    "held",
    "transferring",
    "transferred",
    "cancelled",
  ]).default("held"),

  payments: model.hasMany(() => Payment),

  status: model.enum(["active", "fully_paid", "partially_paid", "unpaid", "cancelled"]).default("unpaid"),

  metadata: model.json().nullable(),
})

export default Stake
