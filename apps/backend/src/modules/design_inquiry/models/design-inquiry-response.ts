import { model } from "@medusajs/framework/utils"

import DesignInquiry from "./design-inquiry"
import DesignInquiryAnswer from "./design-inquiry-answer"

/** One partner's reply to one inquiry. */
const DesignInquiryResponse = model.define("design_inquiry_response", {
  id: model.id({ prefix: "dinqr" }).primaryKey(),

  inquiry: model.belongsTo(() => DesignInquiry, { mappedBy: "responses" }),

  partner_id: model.text().searchable(),

  /**
   * `with_changes` is the answer that matters most and the one a yes/no would
   * have thrown away: "not in that GSM, but I can do 90" is how a design
   * actually develops. Nullable until they submit — a response row exists from
   * the moment they are invited, so a partner who never answers is visible as
   * silence rather than absent from the comparison entirely.
   */
  verdict: model
    .enum(["can_make", "cannot_make", "with_changes"])
    .nullable(),

  lead_time_days: model.number().nullable(),

  indicative_price: model.bigNumber().nullable(),
  currency_code: model.text().nullable(),

  notes: model.text().nullable(),

  /** How this answer arrived — see PartnerCapabilitySample.source. */
  channel: model
    .enum(["wizard", "assistant", "whatsapp", "admin"])
    .default("wizard"),

  invited_at: model.dateTime().nullable(),
  submitted_at: model.dateTime().nullable(),

  metadata: model.json().nullable(),

  answers: model.hasMany(() => DesignInquiryAnswer, { mappedBy: "response" }),
})
  .cascades({ delete: ["answers"] })
  .indexes([
    { on: ["inquiry_id"], name: "idx_design_inquiry_response_inquiry" },
    { on: ["partner_id"], name: "idx_design_inquiry_response_partner" },
    {
      on: ["inquiry_id", "partner_id"],
      name: "uniq_design_inquiry_response_partner",
      unique: true,
    },
  ])

export default DesignInquiryResponse
