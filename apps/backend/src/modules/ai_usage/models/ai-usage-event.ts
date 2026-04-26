import { model } from "@medusajs/framework/utils"

/**
 * AI Usage Event
 *
 * Append-only record of each AI operation a partner runs. Used to enforce
 * per-partner monthly quotas and drive the upgrade prompt. Not a metering
 * ledger — if you need billing precision later, replace this with something
 * heavier. For now it's the smallest thing that answers "how many times has
 * this partner hit the describe endpoint this month?"
 */
const AiUsageEvent = model.define("ai_usage_event", {
  id: model.id().primaryKey(),
  partner_id: model.text().index(),
  operation: model.text().index(),
  metadata: model.json().nullable(),
})

export default AiUsageEvent
