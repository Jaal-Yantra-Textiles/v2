import { model } from "@medusajs/framework/utils"

import DesignInquiry from "./design-inquiry"

/**
 * One question in the wizard, generated from the design's own specification.
 *
 * Persisted rather than derived on read: the spec moves, and a question that
 * silently rewords itself between being asked and being answered makes the
 * answer meaningless. These rows are the record of what was actually put to the
 * partner.
 */
const DesignInquiryQuestion = model.define("design_inquiry_question", {
  id: model.id({ prefix: "dinqq" }).primaryKey(),

  inquiry: model.belongsTo(() => DesignInquiry, { mappedBy: "questions" }),

  /**
   * The wizard step this belongs to — a `design_specifications.category`
   * ("Materials", "Measurements", ...). The categories ARE the steps; grouping
   * by them is why the wizard needs no layout of its own.
   */
  step: model.text(),

  order: model.number().default(0),

  kind: model
    .enum(["yes_no", "colour_select", "number", "text", "photo"])
    .default("yes_no"),

  prompt: model.text(),

  /** Choices for `colour_select` — palette values carrying `metadata.hex`. */
  options: model.json().nullable(),

  /**
   * Where in the spec this came from, so an answer can be traced back to the
   * requirement it was about rather than to a sentence.
   */
  spec_field_ref: model.text().nullable(),

  metadata: model.json().nullable(),
}).indexes([{ on: ["inquiry_id"], name: "idx_design_inquiry_question_inquiry" }])

export default DesignInquiryQuestion
