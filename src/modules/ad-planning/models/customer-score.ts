import { model } from "@medusajs/framework/utils"

/**
 * CustomerScore
 *
 * Stores computed scores (NPS, engagement, CLV, churn risk) per customer.
 * Supports multiple score types with breakdown details.
 */
const CustomerScore = model.define("CustomerScore", {
  id: model.id().primaryKey(),

  // Customer link
  person_id: model.text(), // Links to Person module

  // Score identification
  score_type: model.enum([
    "nps",            // Net Promoter Score (-100 to 100)
    "engagement",     // Engagement score (0 to 100)
    "clv",            // Customer Lifetime Value (monetary)
    "churn_risk",     // Churn risk (0 to 100, higher = more risk)
    "satisfaction"    // General satisfaction score
  ]),

  // Score value
  score_value: model.float(),

  // Breakdown (JSON - component scores)
  // Example for engagement: { "web_activity": 30, "social_engagement": 20, "purchases": 50 }
  breakdown: model.json().nullable(),

  // Confidence (for AI-predicted scores)
  confidence: model.float().nullable(), // 0 to 1

  // Trend
  previous_score: model.float().nullable(),
  score_change: model.float().nullable(), // Difference from previous
  trend_direction: model.enum(["up", "down", "stable"]).nullable(),

  // Freshness tracking
  calculated_at: model.dateTime(),
  expires_at: model.dateTime().nullable(), // When score should be recalculated

  // Source data window
  data_window_days: model.number().default(30), // How many days of data used

  // Metadata
  metadata: model.json().nullable(),
})
.indexes([
  {
    on: ["person_id", "score_type"],
    unique: true,
    name: "idx_score_person_type_unique",
  },
  {
    on: ["score_type", "score_value"],
    name: "idx_score_type_value",
  },
  {
    on: ["score_type", "calculated_at"],
    name: "idx_score_type_time",
  },
])

export default CustomerScore
