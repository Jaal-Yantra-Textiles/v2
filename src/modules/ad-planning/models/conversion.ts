import { model } from "@medusajs/framework/utils"

/**
 * Conversion
 *
 * Tracks conversion events tied to ad campaigns.
 * Supports multiple conversion types: leads, purchases, page engagements, custom events.
 * Links to analytics sessions, orders, and ad campaigns for full attribution.
 */
const Conversion = model.define("Conversion", {
  id: model.id().primaryKey(),

  // Conversion identification
  conversion_type: model.enum([
    "lead_form_submission",
    "add_to_cart",
    "begin_checkout",
    "purchase",
    "page_engagement",
    "scroll_depth",
    "time_on_site",
    "custom"
  ]).default("custom"),
  conversion_name: model.text().searchable().nullable(), // Custom name for the conversion

  // Attribution links (resolved from UTM or direct)
  ad_campaign_id: model.text().nullable(), // Links to AdCampaign from socials module
  ad_set_id: model.text().nullable(), // Links to AdSet
  ad_id: model.text().nullable(), // Links to Ad
  platform: model.enum(["meta", "google", "generic", "direct"]).default("direct"),

  // UTM Attribution (raw values)
  utm_source: model.text().nullable(),
  utm_medium: model.text().nullable(),
  utm_campaign: model.text().nullable(),
  utm_term: model.text().nullable(),
  utm_content: model.text().nullable(),

  // Attribution model
  attribution_model: model.enum([
    "last_click",
    "first_click",
    "linear",
    "time_decay"
  ]).default("last_click"),
  attribution_weight: model.float().default(1.0),

  // Value tracking
  conversion_value: model.bigNumber().nullable(), // Monetary value
  currency: model.text().default("INR"),

  // Order linkage (for purchase conversions)
  order_id: model.text().nullable(),

  // Analytics linkage
  analytics_event_id: model.text().nullable(), // Links to AnalyticsEvent
  analytics_session_id: model.text().nullable(), // Links to AnalyticsSession

  // Lead linkage
  lead_id: model.text().nullable(), // Links to Lead from socials module

  // Person linkage
  person_id: model.text().nullable(), // Links to Person

  // Visitor tracking
  visitor_id: model.text(), // Hashed visitor identifier
  session_id: model.text().nullable(),

  // Website
  website_id: model.text().nullable(),

  // Timestamps
  converted_at: model.dateTime(),

  // Additional metadata
  metadata: model.json().nullable(),
})
.indexes([
  {
    on: ["website_id", "converted_at"],
    name: "idx_conversion_website_time",
  },
  {
    on: ["ad_campaign_id"],
    name: "idx_conversion_campaign",
  },
  {
    on: ["conversion_type", "converted_at"],
    name: "idx_conversion_type_time",
  },
  {
    on: ["person_id"],
    name: "idx_conversion_person",
  },
  {
    on: ["visitor_id"],
    name: "idx_conversion_visitor",
  },
])

export default Conversion
