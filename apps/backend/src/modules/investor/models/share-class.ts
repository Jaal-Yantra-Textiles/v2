import { model } from "@medusajs/framework/utils"
import CapTable from "./cap-table"
import Stake from "./stake"

const ShareClass = model.define("share_class", {
  id: model.id().primaryKey(),

  cap_table: model.belongsTo(() => CapTable, {
    mappedBy: "share_classes",
  }),

  name: model.text().searchable(),
  class_type: model.enum([
    "common",
    "preferred",
    "convertible_note",
    "safe",
    "warrant",
    "option",
  ]).default("common"),

  authorized_shares: model.bigNumber().nullable(),
  issued_shares: model.bigNumber().nullable(),
  outstanding_shares: model.bigNumber().nullable(),

  par_value: model.bigNumber().nullable(),
  liquidation_preference: model.bigNumber().nullable(),
  liquidation_preference_type: model.enum([
    "none",
    "non_participating",
    "participating",
  ]).default("none"),

  dividend_rate: model.number().nullable(),
  conversion_ratio: model.number().nullable(),
  voting_rights: model.enum(["full", "limited", "none"]).default("full"),

  is_convertible: model.boolean().default(false),
  notes: model.text().nullable(),

  stakes: model.hasMany(() => Stake),

  metadata: model.json().nullable(),
})

export default ShareClass
