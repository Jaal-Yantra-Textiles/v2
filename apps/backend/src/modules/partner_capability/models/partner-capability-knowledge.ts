import { model } from "@medusajs/framework/utils"

/**
 * One thing we have LEARNED about a partner's capability — "handles 60 lea
 * linen", "10 m takes about three weeks", "no natural indigo in monsoon".
 *
 * Append-only rows, not a notes field on the sample. Knowledge accumulates
 * from different channels at different times, and a single text/json field is
 * replaced wholesale on update, so the second fact would erase the first
 * (feedback_no_critical_data_in_metadata). Each fact carries its OWN source and
 * observed_at because a website claim, a WhatsApp answer and an operator's note
 * are not equally reliable, and a fact from last year may no longer hold.
 *
 * `sample_id` is optional: some knowledge is about one product line, some is
 * about the partner as a whole ("works only in natural dyes").
 */
const PartnerCapabilityKnowledge = model
  .define("partner_capability_knowledge", {
    id: model.id({ prefix: "pcapk" }).primaryKey(),

    partner_id: model.text().searchable(),

    /** The sample this fact is about, or null for a partner-wide fact. */
    sample_id: model.text().nullable(),

    fact: model.text().searchable(),

    source: model
      .enum(["wizard", "assistant", "whatsapp", "admin", "website"])
      .default("admin"),

    /** Where the fact was read, when it came from a page. */
    source_url: model.text().nullable(),

    /** When the fact was TRUE/observed — not when it was typed up. */
    observed_at: model.dateTime(),

    metadata: model.json().nullable(),
  })
  .indexes([
    { on: ["partner_id"], name: "idx_partner_capability_knowledge_partner" },
    { on: ["sample_id"], name: "idx_partner_capability_knowledge_sample" },
  ])

export default PartnerCapabilityKnowledge
