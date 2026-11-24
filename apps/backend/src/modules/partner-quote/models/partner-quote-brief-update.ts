import { model } from "@medusajs/framework/utils"

import PartnerQuoteBrief from "./partner-quote-brief"

/**
 * Something we tell the buyer on the SAME link: "4 sample bags are being
 * stitched in Dharamshala", photos of the samples, a confirmed price.
 * Shown newest first on the brief page.
 */
const PartnerQuoteBriefUpdate = model.define("partner_quote_brief_update", {
  id: model.id({ prefix: "qbupd" }).primaryKey(),
  brief: model.belongsTo(() => PartnerQuoteBrief, { mappedBy: "updates" }),

  kind: model.enum(["note", "sample", "price"]).default("note"),
  message: model.text(),
  /** Public image URLs. */
  media_urls: model.json().nullable(),
  actor_type: model.text().default("admin"),
  actor_id: model.text().nullable(),
})

export default PartnerQuoteBriefUpdate
