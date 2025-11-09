import { model } from "@medusajs/framework/utils";

const AnalyticsSession = model.define("analytics_session", {
  id: model.id().primaryKey(),
  
  // Website Reference (stored as text ID, linked via module link)
  website_id: model.text(),
  
  // Session Identifiers
  session_id: model.text().unique(),
  visitor_id: model.text(),
  
  // Session Metrics
  entry_page: model.text(),
  exit_page: model.text().nullable(),
  pageviews: model.number().default(1),
  duration_seconds: model.number().nullable(),
  is_bounce: model.boolean().default(false), // Single page visit
  
  // Session Details
  referrer: model.text().nullable(),
  referrer_source: model.text().nullable(),
  country: model.text().nullable(),
  device_type: model.text().nullable(),
  browser: model.text().nullable(),
  os: model.text().nullable(),
  
  // Timestamps
  started_at: model.dateTime(),
  ended_at: model.dateTime().nullable(),
  last_activity_at: model.dateTime(),
})
.indexes([
  {
    on: ["website_id", "started_at"],
  },
  {
    on: ["session_id"],
    unique: true,
  },
  {
    on: ["visitor_id"],
  },
  {
    on: ["website_id", "is_bounce"],
  },
]);

export default AnalyticsSession;
