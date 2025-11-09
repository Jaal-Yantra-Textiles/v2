import { model } from "@medusajs/framework/utils";

const AnalyticsDailyStats = model.define("analytics_daily_stats", {
  id: model.id().primaryKey(),
  
  // Website Reference (stored as text ID, linked via module link)
  website_id: model.text(),
  
  // Date for this stats record (stored as dateTime, but only date part used)
  date: model.dateTime(),
  
  // Traffic Metrics
  pageviews: model.number().default(0),
  unique_visitors: model.number().default(0),
  sessions: model.number().default(0),
  bounce_rate: model.float().default(0), // Percentage
  avg_session_duration: model.float().default(0), // In seconds
  
  // Top Content (JSON arrays)
  top_pages: model.json().nullable(), // [{path, views, unique_visitors}]
  top_referrers: model.json().nullable(), // [{source, visitors}]
  top_countries: model.json().nullable(), // [{country, visitors}]
  
  // Device Breakdown
  desktop_visitors: model.number().default(0),
  mobile_visitors: model.number().default(0),
  tablet_visitors: model.number().default(0),
  
  // Browser/OS Stats (JSON)
  browser_stats: model.json().nullable(), // [{browser, count}]
  os_stats: model.json().nullable(), // [{os, count}]
})
.indexes([
  {
    on: ["website_id", "date"],
    unique: true,
  },
  {
    on: ["date"],
  },
]);

export default AnalyticsDailyStats;
