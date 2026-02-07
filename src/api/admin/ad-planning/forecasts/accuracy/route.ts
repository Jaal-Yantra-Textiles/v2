/**
 * Forecast Accuracy API
 * Compare forecasts against actual performance
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { z } from "zod";
import { AD_PLANNING_MODULE } from "../../../../../modules/ad-planning";
import { calculateForecastAccuracy } from "../../../../../modules/ad-planning/utils/forecast-engine";

const AccuracyQuerySchema = z.object({
  forecast_id: z.string().optional(),
  ad_campaign_id: z.string().optional(),
});

/**
 * Get forecast accuracy
 * @route GET /admin/ad-planning/forecasts/accuracy
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const params = AccuracyQuerySchema.parse(req.query);
  const adPlanningService = req.scope.resolve(AD_PLANNING_MODULE);

  const filters: Record<string, any> = {
    is_actual_recorded: true,
  };
  if (params.forecast_id) filters.id = params.forecast_id;
  if (params.ad_campaign_id) filters.ad_campaign_id = params.ad_campaign_id;

  const forecasts = await adPlanningService.listBudgetForecasts(filters);

  if (forecasts.length === 0) {
    res.json({
      accuracy_reports: [],
      overall_accuracy: null,
      message: "No completed forecasts found",
    });
    return;
  }

  const accuracyReports: Array<{
    forecast_id: string;
    campaign_id: string | null;
    period_start: string;
    period_end: string;
    accuracy: number;
    mape: number;
    comparison_count: number;
  }> = [];

  let totalAccuracy = 0;
  let count = 0;

  for (const forecast of forecasts) {
    // Get metadata for period info
    const forecastMetadata = forecast.metadata as Record<string, any> | null;
    const periodStart = forecastMetadata?.forecast_period_start ? new Date(forecastMetadata.forecast_period_start) : forecast.forecast_date;
    const periodEnd = forecastMetadata?.forecast_period_end ? new Date(forecastMetadata.forecast_period_end) : new Date(forecast.forecast_date.getTime() + 30 * 24 * 60 * 60 * 1000);

    // Get actual conversions for this period and campaign
    const conversions = await adPlanningService.listConversions({
      ad_campaign_id: forecast.ad_campaign_id,
      converted_at: {
        $gte: periodStart,
        $lte: periodEnd,
      },
    });

    // Aggregate actual revenue by day
    const actualByDay: Record<string, number> = {};
    for (const conv of conversions) {
      const dateKey = new Date(conv.converted_at).toISOString().split("T")[0];
      actualByDay[dateKey] = (actualByDay[dateKey] || 0) + (Number(conv.conversion_value) || 0);
    }

    const actuals = Object.entries(actualByDay).map(([date, revenue]) => ({
      date,
      actual_revenue: revenue,
    }));

    // Get daily forecasts from metadata
    const dailyForecasts = forecastMetadata?.daily_forecasts || [];

    if (dailyForecasts.length > 0 && actuals.length > 0) {
      const accuracy = calculateForecastAccuracy(dailyForecasts, actuals);

      accuracyReports.push({
        forecast_id: forecast.id,
        campaign_id: forecast.ad_campaign_id,
        period_start: periodStart.toISOString(),
        period_end: periodEnd.toISOString(),
        accuracy: accuracy.accuracy,
        mape: accuracy.mape,
        comparison_count: accuracy.comparisons.length,
      });

      totalAccuracy += accuracy.accuracy;
      count++;

      // Update forecast with actual data
      await adPlanningService.updateBudgetForecasts({
        id: forecast.id,
        actual_spend: forecast.predicted_spend, // Would need actual spend data
        actual_conversions: conversions.length,
        actual_revenue: Object.values(actualByDay).reduce((a, b) => a + b, 0),
        forecast_error_percent: 100 - accuracy.accuracy,
        is_actual_recorded: true,
      });
    }
  }

  res.json({
    accuracy_reports: accuracyReports,
    overall_accuracy: count > 0 ? Math.round((totalAccuracy / count) * 100) / 100 : null,
    forecasts_analyzed: count,
  });
};
