import { model } from "@medusajs/framework/utils"

/**
 * CustomerJourney
 *
 * Tracks cross-channel interaction timeline per customer.
 * Captures all touchpoints: forms, feedback, purchases, social engagement, etc.
 */
const CustomerJourney = model.define("CustomerJourney", {
  id: model.id().primaryKey(),

  // Customer link
  person_id: model.text().nullable(), // Links to Person (may be null for anonymous)
  visitor_id: model.text().nullable(), // For anonymous tracking

  // Event identification
  event_type: model.enum([
    "form_submit",
    "feedback",
    "purchase",
    "page_view",
    "social_engage",
    "lead_capture",
    "email_open",
    "email_click",
    "ad_click",
    "support_ticket",
    "custom"
  ]),
  event_name: model.text().nullable(), // Custom event name

  // Event data (JSON for flexibility)
  // Example: { "form_id": "...", "form_name": "Contact Form", "responses": {...} }
  event_data: model.json().nullable(),

  // Channel
  channel: model.enum([
    "web",
    "social",
    "email",
    "sms",
    "phone",
    "in_person",
    "ad"
  ]).default("web"),

  // Funnel stage
  stage: model.enum([
    "awareness",     // First touchpoint
    "interest",      // Showing interest
    "consideration", // Comparing options
    "intent",        // Ready to buy
    "conversion",    // Made a purchase
    "retention",     // Repeat customer
    "advocacy"       // Referring others
  ]).default("awareness"),

  // Source reference
  source_type: model.text().nullable(), // "feedback", "form_response", "order", etc.
  source_id: model.text().nullable(), // ID of the source record

  // Attribution
  utm_source: model.text().nullable(),
  utm_campaign: model.text().nullable(),
  ad_campaign_id: model.text().nullable(),

  // Website
  website_id: model.text().nullable(),
  page_url: model.text().nullable(),

  // Timestamp
  occurred_at: model.dateTime(),

  // Metadata
  metadata: model.json().nullable(),
})
.indexes([
  {
    on: ["person_id", "occurred_at"],
    name: "idx_journey_person_time",
  },
  {
    on: ["visitor_id", "occurred_at"],
    name: "idx_journey_visitor_time",
  },
  {
    on: ["event_type", "occurred_at"],
    name: "idx_journey_type_time",
  },
  {
    on: ["stage"],
    name: "idx_journey_stage",
  },
  {
    on: ["website_id", "occurred_at"],
    name: "idx_journey_website_time",
  },
])

export default CustomerJourney
