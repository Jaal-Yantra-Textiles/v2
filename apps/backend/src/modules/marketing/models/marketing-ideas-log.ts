import { model } from "@medusajs/framework/utils"

/**
 * marketing_ideas_log — one row per generated tactical-ideas email (#659 slice 1).
 * Report §4.4. Exists for recall, A/B, and the hallucination-guard post-mortem.
 * `prompt_snapshot` (the ground-truth numbers fed in) + `guard_failures` make
 * slice 2's hallucination guard auditable and replayable — which is exactly why
 * this is a typed table, not metadata.
 */
const MarketingIdeasLog = model
  .define("marketing_ideas_log", {
    id: model.id().primaryKey(),
    generated_for_date: model.dateTime(),
    model_used: model.text().nullable(),
    prompt_snapshot: model.json(), // the ground-truth numbers fed in (guard input)
    output_text: model.text(), // the generated email body
    guard_passed: model.boolean().default(false), // did the §7 number-guard pass?
    guard_failures: model.json().nullable(), // [{token, expected, found}] when it didn't
    regenerated: model.boolean().default(false),
    sent: model.boolean().default(false), // did it actually go out, or flag-for-review?
  })
  .indexes([{ on: ["generated_for_date"] }, { on: ["guard_passed"] }])

export default MarketingIdeasLog
