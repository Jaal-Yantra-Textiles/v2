import { model } from "@medusajs/framework/utils"

/**
 * ABExperiment
 *
 * Tracks A/B testing experiments for ad campaigns.
 * Supports multiple variants with statistical significance calculation.
 */
const ABExperiment = model.define("ABExperiment", {
  id: model.id().primaryKey(),

  // Experiment identification
  name: model.text().searchable(),
  description: model.text().nullable(),

  // Experiment status
  status: model.enum(["draft", "running", "paused", "completed"]).default("draft"),
  experiment_type: model.enum([
    "ad_creative",
    "landing_page",
    "audience",
    "budget",
    "bidding"
  ]).default("ad_creative"),

  // Variants configuration (JSON array)
  // Example: [{ "id": "control", "name": "Control", "weight": 50, "campaign_id": "..." }]
  variants: model.json(),

  // Statistical settings
  target_sample_size: model.number().nullable(),
  confidence_level: model.float().default(0.95), // 95% confidence
  minimum_detectable_effect: model.float().nullable(),

  // Primary metric to optimize
  primary_metric: model.enum([
    "conversion_rate",
    "ctr",
    "cpc",
    "roas",
    "leads",
    "revenue"
  ]).default("conversion_rate"),

  // Results (JSON - updated as experiment runs)
  // Example: { "control": { "conversions": 150, "visitors": 5000, "rate": 0.03 }, "winner": "variant_a" }
  results: model.json().nullable(),

  // Statistical significance
  is_significant: model.boolean().default(false),
  p_value: model.float().nullable(),
  improvement_percent: model.float().nullable(),

  // Schedule
  started_at: model.dateTime().nullable(),
  ended_at: model.dateTime().nullable(),

  // Website association
  website_id: model.text().nullable(),

  // Metadata
  metadata: model.json().nullable(),
})
.indexes([
  {
    on: ["status"],
    name: "idx_experiment_status",
  },
  {
    on: ["website_id", "status"],
    name: "idx_experiment_website_status",
  },
])

export default ABExperiment
