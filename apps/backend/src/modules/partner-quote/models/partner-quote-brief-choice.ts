import { model } from "@medusajs/framework/utils"

import PartnerQuoteBriefStep from "./partner-quote-brief-step"

/**
 * A partner who could do a step, shown BY NAME to the buyer with their sample
 * photos (decided 2026-11-25: buyers want to know who they work with).
 *
 * `rate_id` points at a live `partner_capability_rate`. No rate = "we'll
 * confirm". The rate is read at view time, never copied here.
 */
const PartnerQuoteBriefChoice = model.define("partner_quote_brief_choice", {
  id: model.id({ prefix: "qbch" }).primaryKey(),
  step: model.belongsTo(() => PartnerQuoteBriefStep, { mappedBy: "choices" }),

  partner_id: model.text(),
  rate_id: model.text().nullable(),
  /** partner_capability_sample ids to show as evidence. */
  sample_ids: model.json().nullable(),
  note: model.text().nullable(),
  position: model.number().default(0),
})

export default PartnerQuoteBriefChoice
