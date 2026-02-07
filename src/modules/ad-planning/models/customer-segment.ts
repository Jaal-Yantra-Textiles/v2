import { model } from "@medusajs/framework/utils"

/**
 * CustomerSegment
 *
 * Defines customer segments with rules-based or behavioral criteria.
 * Supports demographic, behavioral, and RFM-based segmentation.
 */
const CustomerSegment = model.define("CustomerSegment", {
  id: model.id().primaryKey(),

  // Segment identification
  name: model.text().searchable(),
  description: model.text().nullable(),

  // Segment type
  segment_type: model.enum([
    "behavioral",    // Based on user actions
    "demographic",   // Based on person attributes
    "rfm",          // Recency, Frequency, Monetary
    "custom"        // Custom rule-based
  ]).default("custom"),

  // Criteria (JSON for flexible rule definitions)
  // Example: {
  //   "rules": [
  //     { "field": "engagement_score", "operator": ">=", "value": 50 },
  //     { "field": "total_orders", "operator": ">=", "value": 3 }
  //   ],
  //   "logic": "AND"
  // }
  criteria: model.json(),

  // Stats
  customer_count: model.number().default(0),
  last_calculated_at: model.dateTime().nullable(),

  // Configuration
  is_active: model.boolean().default(true),
  auto_update: model.boolean().default(true), // Recalculate on schedule

  // Color for UI display
  color: model.text().nullable(), // Hex color code

  // Metadata
  metadata: model.json().nullable(),
})
.indexes([
  {
    on: ["is_active"],
    name: "idx_segment_active",
  },
  {
    on: ["segment_type"],
    name: "idx_segment_type",
  },
])

export default CustomerSegment
