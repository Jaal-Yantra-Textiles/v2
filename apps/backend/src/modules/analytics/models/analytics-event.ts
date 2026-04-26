import { model } from "@medusajs/framework/utils";

const AnalyticsEvent = model.define("analytics_event", {
  id: model.id().primaryKey(),
  
  // Website Reference (stored as text ID, linked via module link)
  website_id: model.text(),
  
  // Event Information
  event_type: model.enum(["pageview", "custom_event"]).default("pageview"),
  event_name: model.text().nullable(), // For custom events
  
  // Page Information
  pathname: model.text(),
  referrer: model.text().nullable(),
  referrer_source: model.text().nullable(), // e.g., "google", "direct", "facebook"
  
  // User Information (Privacy-focused - no PII)
  visitor_id: model.text(), // Hashed fingerprint
  session_id: model.text(), // Temporary session identifier
  
  // Technical Details
  user_agent: model.text().nullable(),
  browser: model.text().nullable(), // Parsed from user_agent
  os: model.text().nullable(), // Parsed from user_agent
  device_type: model.enum(["desktop", "mobile", "tablet", "unknown"]).default("unknown"),
  
  // Geographic Data (Country-level only for privacy)
  country: model.text().nullable(),
  
  // UTM Parameters (Marketing Attribution)
  utm_source: model.text().nullable(),
  utm_medium: model.text().nullable(),
  utm_campaign: model.text().nullable(),
  utm_term: model.text().nullable(),
  utm_content: model.text().nullable(),
  
  // Query String (Full URL parameters)
  query_string: model.text().nullable(),
  
  // Error Tracking
  is_404: model.boolean().default(false),
  
  // Additional Data
  metadata: model.json().nullable(),
  
  // Timestamps
  timestamp: model.dateTime(),
})
.indexes([
  {
    on: ["website_id", "timestamp"],
  },
  {
    on: ["website_id", "pathname", "timestamp"],
  },
  {
    on: ["session_id"],
  },
  {
    on: ["visitor_id"],
  },
  {
    on: ["website_id", "event_type", "timestamp"],
  },
]);

export default AnalyticsEvent;
