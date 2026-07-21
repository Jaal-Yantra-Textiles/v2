import { model } from "@medusajs/framework/utils"

/**
 * AI Usage Event
 *
 * Append-only record of each AI operation. Originally per-partner image quota
 * enforcement (`partner_id` + `operation` = an image_describe/segment/depth
 * call). Extended for the MCP observability ledger (#844): every MCP tool
 * dispatch across the store/partner/admin surfaces lands here too, so
 * `partner_id` is now nullable (admin actors aren't partners) and the actor is
 * captured via `surface` + `actor_id` + `actor_type`. Quota reads still filter
 * on `partner_id` + `operation`; ledger reads filter on `surface`.
 *
 * Still not a billing-grade meter — if you need precision later, replace this
 * with something heavier.
 */
const AiUsageEvent = model.define("ai_usage_event", {
  id: model.id().primaryKey(),
  // Nullable for MCP ledger rows (admin/store actors aren't partners). DB
  // indexes are maintained by the migrations, so no model-level `.index()`.
  partner_id: model.text().nullable(),
  operation: model.text().index(),
  // MCP ledger (#844): the surface that handled the call and the actor behind
  // it. Null for the legacy partner-image quota rows.
  surface: model.text().nullable(),
  actor_id: model.text().nullable(),
  actor_type: model.text().nullable(),
  metadata: model.json().nullable(),
})

export default AiUsageEvent
