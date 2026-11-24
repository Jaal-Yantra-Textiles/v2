import { model } from "@medusajs/framework/utils"

import PartnerQuoteBrief from "./partner-quote-brief"

/**
 * A question the buyer answers on the brief (quantity, size, print spots…).
 * Questions are rows, not code, so each brief asks what that job needs.
 */
const PartnerQuoteBriefQuestion = model.define("partner_quote_brief_question", {
  id: model.id({ prefix: "qbq" }).primaryKey(),
  brief: model.belongsTo(() => PartnerQuoteBrief, { mappedBy: "questions" }),

  /** Stable key, e.g. "quantity". Unique within a brief. */
  key: model.text(),
  label: model.text(),
  help: model.text().nullable(),
  kind: model
    .enum(["text", "long_text", "number", "choice", "multi_choice", "date", "boolean", "link"])
    .default("text"),
  /** For choice / multi_choice: the allowed values. */
  options: model.json().nullable(),
  required: model.boolean().default(false),
  position: model.number().default(0),

  /** The buyer's answer, already validated against `kind`. */
  answer: model.json().nullable(),
  answered_at: model.dateTime().nullable(),
})

export default PartnerQuoteBriefQuestion
