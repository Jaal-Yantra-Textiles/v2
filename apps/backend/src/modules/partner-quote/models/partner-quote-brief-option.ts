import { model } from "@medusajs/framework/utils"

import PartnerQuoteBrief from "./partner-quote-brief"
import PartnerQuoteBriefStep from "./partner-quote-brief-step"

/**
 * One way the piece could be made ("Crossbody bag, canvas, screen-printed
 * front"). The buyer can mark the options she is interested in.
 */
const PartnerQuoteBriefOption = model.define("partner_quote_brief_option", {
  id: model.id({ prefix: "qbopt" }).primaryKey(),
  brief: model.belongsTo(() => PartnerQuoteBrief, { mappedBy: "options" }),

  title: model.text(),
  description: model.text().nullable(),
  /**
   * The story the BUYER can tell her own customers about this style, in our
   * words ("Hand-painted in Himachal…"). Optional; the page adds factual craft
   * lines per step beside it. Never invented: write only what is true.
   */
  story: model.text().nullable(),
  position: model.number().default(0),

  /** Set by the buyer on the brief page. */
  buyer_selected: model.boolean().default(false),

  steps: model.hasMany(() => PartnerQuoteBriefStep, { mappedBy: "option" }),
})

export default PartnerQuoteBriefOption
