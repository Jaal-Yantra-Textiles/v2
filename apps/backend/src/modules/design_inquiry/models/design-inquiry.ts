import { model } from "@medusajs/framework/utils"

import DesignInquiryQuestion from "./design-inquiry-question"
import DesignInquiryResponse from "./design-inquiry-response"

/**
 * One act of asking partners what they can make for a design.
 *
 * Before a customer orders anything, a design is shown to several partners:
 * "do you have these colours?", "can you do this GSM?". Until now that exchange
 * lived in WhatsApp threads — what we asked was unrecoverable a week later, and
 * who ended up making the sample was decided from memory.
 *
 * One inquiry, many partners, one set of questions. That is the point: the
 * questions belong to the ASK, not to each thread, so two partners' answers are
 * comparable side by side.
 */
const DesignInquiry = model.define("design_inquiry", {
  id: model.id({ prefix: "dinq" }).primaryKey(),

  design_id: model.text().searchable(),

  title: model.text(),

  /** Free-text framing shown above the questions. */
  brief_note: model.text().nullable(),

  /**
   * media_file ids for what we SEND — reference images, spec sheets.
   *
   * On the inquiry rather than in each partner's thread, because the whole
   * value of recording the outbound half is being able to answer "what exactly
   * was this partner shown?" months later, and per-thread copies drift.
   */
  reference_media_ids: model.json().nullable(),

  /**
   * The `design_specifications.version` the questions were generated from.
   *
   * A spec is versioned and moves while sourcing is in progress. Without this,
   * an answer of "yes, we can do that" is unreadable — it does not say WHICH
   * "that" was agreed to.
   */
  spec_version: model.text().nullable(),

  status: model.enum(["open", "closed"]).default("open"),

  created_by: model.text().nullable(),
  closed_at: model.dateTime().nullable(),

  metadata: model.json().nullable(),

  questions: model.hasMany(() => DesignInquiryQuestion, { mappedBy: "inquiry" }),
  responses: model.hasMany(() => DesignInquiryResponse, { mappedBy: "inquiry" }),
})
  .cascades({ delete: ["questions", "responses"] })
  .indexes([{ on: ["design_id"], name: "idx_design_inquiry_design" }])

export default DesignInquiry
