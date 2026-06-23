import { model } from "@medusajs/framework/utils"

/**
 * marketing_metric_snapshot — append-only headline/trend rows (#659 slice 1).
 *
 * Goal-agnostic: one row per (metric_key, captured_for_date) storing any named
 * metric, so the still-open "One Goal" decision doesn't gate this table. The One
 * Goal only picks WHICH metric_key is rendered as the headline (slice 3); it is a
 * value here, not a schema change. The unique index makes slice 3's daily upsert
 * idempotent.
 */
const MarketingMetricSnapshot = model
  .define("marketing_metric_snapshot", {
    id: model.id().primaryKey(),
    metric_key: model.text(), // "platform_gmv" | "partner_activations" | "storefront_conversion" | ...
    value: model.float().default(0), // float covers currency + ratio (see spec §3.6 on money)
    unit: model.text().nullable(), // "INR" | "count" | "ratio" | null
    captured_for_date: model.dateTime(), // the business day this snapshot is FOR (IST midnight)
    source: model.text().nullable(), // "daily-refresh" | "manual" | "backfill"
    breakdown: model.json().nullable(), // optional [{label, value}] for drill-downs
    delta_dod: model.float().nullable(), // day-over-day delta, precomputed by the job
  })
  .indexes([
    { on: ["metric_key", "captured_for_date"], unique: true }, // idempotent daily upsert
    { on: ["captured_for_date"] },
  ])

export default MarketingMetricSnapshot
