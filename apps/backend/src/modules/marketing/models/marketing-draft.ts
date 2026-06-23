import { model } from "@medusajs/framework/utils"

/**
 * marketing_draft — newsletter/campaign drafts by name (#659 slice 1).
 * Report §4.5: operator-review, never auto-send. Slice 4 (newsletter generator)
 * writes here; slice 2's ideas email may also persist as kind="ideas_email".
 */
const MarketingDraft = model
  .define("marketing_draft", {
    id: model.id().primaryKey(),
    name: model.text(), // human label, e.g. "weekly-2026-06-23"
    kind: model
      .enum(["newsletter", "campaign", "ideas_email"])
      .default("newsletter"),
    status: model
      .enum(["draft", "approved", "sent", "discarded"])
      .default("draft"),
    payload: model.json(), // {subject, preheader, intro, sections[], ...}
    model_used: model.text().nullable(), // which LLM produced it (for recall/A-B)
    approved_by: model.text().nullable(),
    sent_at: model.dateTime().nullable(),
  })
  .indexes([{ on: ["name"] }, { on: ["kind", "status"] }])

export default MarketingDraft
