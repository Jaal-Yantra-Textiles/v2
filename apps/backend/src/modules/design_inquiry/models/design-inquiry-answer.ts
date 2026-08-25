import { model } from "@medusajs/framework/utils"

import DesignInquiryResponse from "./design-inquiry-response"

/**
 * One partner's answer to one question.
 *
 * `value` is json because the answer shape follows the question kind — a bool,
 * a number, a list of chosen colour values. `note` and `capability_sample_ids`
 * sit alongside it rather than inside it because they are present for EVERY
 * kind: the useful part of "no" is almost always the sentence after it, and the
 * useful part of "yes" is the photograph proving it.
 */
const DesignInquiryAnswer = model.define("design_inquiry_answer", {
  id: model.id({ prefix: "dinqa" }).primaryKey(),

  response: model.belongsTo(() => DesignInquiryResponse, {
    mappedBy: "answers",
  }),

  question_id: model.text(),

  value: model.json().nullable(),

  note: model.text().nullable(),

  /** partner_capability_sample ids — the evidence for this answer. */
  capability_sample_ids: model.json().nullable(),

  metadata: model.json().nullable(),
}).indexes([
  { on: ["response_id"], name: "idx_design_inquiry_answer_response" },
  {
    on: ["response_id", "question_id"],
    name: "uniq_design_inquiry_answer_question",
    unique: true,
  },
])

export default DesignInquiryAnswer
