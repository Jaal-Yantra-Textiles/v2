import { model } from "@medusajs/framework/utils"

import PartnerQuoteBriefChoice from "./partner-quote-brief-choice"
import PartnerQuoteBriefOption from "./partner-quote-brief-option"

/**
 * One step of an option: the fabric, a print, the stitching.
 *
 * A step with NO choices is shown as "we're exploring partners for this"
 * (decided 2026-11-25): offered, not hidden, and never priced.
 */
const PartnerQuoteBriefStep = model.define("partner_quote_brief_step", {
  id: model.id({ prefix: "qbstep" }).primaryKey(),
  option: model.belongsTo(() => PartnerQuoteBriefOption, { mappedBy: "steps" }),

  position: model.number().default(0),
  label: model.text(),
  /** `fabric` is material bought by length; `process` is work done to it. */
  kind: model.enum(["fabric", "process"]).default("process"),
  /** A slug from partner_capability/lib/techniques.ts, when there is one. */
  technique: model.text().nullable(),

  /**
   * How much of the rate's unit ONE piece uses (0.8 metre of fabric per bag).
   * Null = one rate unit per piece. Only used for the estimate.
   */
  qty_per_piece: model.float().nullable(),

  note: model.text().nullable(),

  /** The buyer's pick when more than one partner can do the step. */
  selected_choice_id: model.text().nullable(),

  choices: model.hasMany(() => PartnerQuoteBriefChoice, { mappedBy: "step" }),
})

export default PartnerQuoteBriefStep
