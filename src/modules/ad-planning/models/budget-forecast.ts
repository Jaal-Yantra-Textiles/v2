import { model } from "@medusajs/framework/utils"

/**
 * BudgetForecast
 *
 * Stores budget forecasting data for ad campaigns.
 * Tracks predicted vs actual performance for forecast accuracy.
 */
const BudgetForecast = model.define("BudgetForecast", {
  id: model.id().primaryKey(),

  // Scope
  ad_account_id: model.text().nullable(), // For account-level forecasts
  ad_campaign_id: model.text().nullable(), // For campaign-level forecasts
  forecast_level: model.enum(["account", "campaign"]).default("campaign"),

  // Forecast period
  forecast_date: model.dateTime(), // Date this forecast is for
  generated_at: model.dateTime(), // When forecast was generated

  // Historical basis
  lookback_days: model.number().default(30), // Days of history used

  // Predicted metrics
  predicted_spend: model.bigNumber().nullable(),
  predicted_impressions: model.bigNumber().nullable(),
  predicted_clicks: model.bigNumber().nullable(),
  predicted_conversions: model.bigNumber().nullable(),
  predicted_revenue: model.bigNumber().nullable(),
  predicted_roas: model.float().nullable(),
  predicted_cpa: model.float().nullable(),
  predicted_cpc: model.float().nullable(),

  // Confidence intervals (JSON)
  // Example: { "spend": { "low": 900, "high": 1100 }, "conversions": { "low": 45, "high": 65 } }
  confidence_intervals: model.json().nullable(),

  // Actual metrics (filled in when date passes)
  actual_spend: model.bigNumber().nullable(),
  actual_impressions: model.bigNumber().nullable(),
  actual_clicks: model.bigNumber().nullable(),
  actual_conversions: model.bigNumber().nullable(),
  actual_revenue: model.bigNumber().nullable(),

  // Accuracy tracking
  forecast_error_percent: model.float().nullable(),
  is_actual_recorded: model.boolean().default(false),

  // Metadata
  metadata: model.json().nullable(),
})
.indexes([
  {
    on: ["ad_campaign_id", "forecast_date"],
    name: "idx_forecast_campaign_date",
  },
  {
    on: ["ad_account_id", "forecast_date"],
    name: "idx_forecast_account_date",
  },
  {
    on: ["forecast_date"],
    name: "idx_forecast_date",
  },
])

export default BudgetForecast
