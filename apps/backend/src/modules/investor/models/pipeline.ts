import { model } from "@medusajs/framework/utils"
import Investor from "./investor"

const Pipeline = model.define("investor_pipeline", {
  id: model.id().primaryKey(),

  investor: model.belongsTo(() => Investor, {
    mappedBy: "pipeline",
  }),

  company_id: model.text().searchable(),

  stage: model.enum([
    "lead",
    "contacted",
    "interested",
    "due_diligence",
    "term_sheet",
    "committed",
    "onboarded",
    "closed",
    "passed",
  ]).default("lead"),

  status: model.enum(["active", "won", "lost", "on_hold"]).default("active"),

  target_amount: model.bigNumber().nullable(),
  committed_amount: model.bigNumber().nullable(),

  source: model.text().nullable(),
  assigned_to: model.text().nullable(),

  next_action: model.text().nullable(),
  next_action_date: model.dateTime().nullable(),

  notes: model.text().nullable(),

  metadata: model.json().nullable(),
})

export default Pipeline
