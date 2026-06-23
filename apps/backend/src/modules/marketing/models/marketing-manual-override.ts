import { model } from "@medusajs/framework/utils"

/**
 * marketing_manual_override — operator corrections to computed data (#659 slice 1).
 * Report §6: when the operator overrides a computed number, record it WITH a
 * reason so the AI guard and dashboard show the human-corrected value, audited.
 * `active` soft-disables instead of deleting. Slice 3 reads these to override the
 * snapshot headline.
 */
const MarketingManualOverride = model
  .define("marketing_manual_override", {
    id: model.id().primaryKey(),
    metric_key: model.text(), // which snapshot metric this overrides
    effective_date: model.dateTime(), // the day the override applies to
    override_value: model.float(),
    reason: model.text(), // required — never a silent override
    actor_id: model.text(), // who made the override
    active: model.boolean().default(true), // soft-disable instead of delete
  })
  .indexes([{ on: ["metric_key", "effective_date"] }])

export default MarketingManualOverride
