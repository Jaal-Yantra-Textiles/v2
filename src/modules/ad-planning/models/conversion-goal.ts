import { model } from "@medusajs/framework/utils"

/**
 * ConversionGoal
 *
 * Defines what qualifies as a conversion.
 * Goals can be based on events, page visits, time on page, scroll depth, etc.
 */
const ConversionGoal = model.define("ConversionGoal", {
  id: model.id().primaryKey(),

  // Goal identification
  name: model.text().searchable(),
  description: model.text().nullable(),

  // Goal type
  goal_type: model.enum([
    "lead_form",
    "purchase",
    "add_to_cart",
    "page_view",
    "time_on_page",
    "scroll_depth",
    "custom_event"
  ]),

  // Conditions (JSON for flexibility)
  // Example: { "event_name": "checkout_complete", "pathname_pattern": "/checkout/success*" }
  conditions: model.json(),

  // Value assignment
  default_value: model.bigNumber().nullable(),
  value_from_event: model.boolean().default(false), // Pull value from event metadata

  // Status
  is_active: model.boolean().default(true),

  // Website association
  website_id: model.text().nullable(),

  // Priority (for when multiple goals match)
  priority: model.number().default(0),

  // Metadata
  metadata: model.json().nullable(),
})
.indexes([
  {
    on: ["website_id", "is_active"],
    name: "idx_goal_website_active",
  },
  {
    on: ["goal_type"],
    name: "idx_goal_type",
  },
])

export default ConversionGoal
