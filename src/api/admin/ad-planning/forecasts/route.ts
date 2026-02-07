/**
 * Admin Budget Forecasts API
 * Generate and manage budget forecasts
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { z } from "zod";
import { AD_PLANNING_MODULE } from "../../../../modules/ad-planning";
import { SOCIALS_MODULE } from "../../../../modules/socials";
import {
  generateForecast,
  recommendBudget,
} from "../../../../modules/ad-planning/utils/forecast-engine";

const ListForecastsQuerySchema = z.object({
  ad_campaign_id: z.string().optional(),
  status: z.enum(["pending", "active", "completed"]).optional(),
  limit: z.coerce.number().default(20),
  offset: z.coerce.number().default(0),
});

const GenerateForecastSchema = z.object({
  ad_campaign_id: z.string(),
  forecast_days: z.number().min(1).max(90).default(30),
  daily_budget: z.number().positive(),
  target_roas: z.number().optional(),
});

/**
 * List forecasts
 * @route GET /admin/ad-planning/forecasts
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const params = ListForecastsQuerySchema.parse(req.query);
  const adPlanningService = req.scope.resolve(AD_PLANNING_MODULE);

  const filters: Record<string, any> = {};
  if (params.ad_campaign_id) filters.ad_campaign_id = params.ad_campaign_id;
  if (params.status) filters.status = params.status;

  const forecasts = await adPlanningService.listBudgetForecasts(filters, {
    skip: params.offset,
    take: params.limit,
    order: { created_at: "DESC" },
  });

  res.json({
    forecasts,
    count: forecasts.length,
    offset: params.offset,
    limit: params.limit,
  });
};

/**
 * Generate forecast
 * @route POST /admin/ad-planning/forecasts
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const data = GenerateForecastSchema.parse(req.body);
  const adPlanningService = req.scope.resolve(AD_PLANNING_MODULE);
  const socialsService = req.scope.resolve(SOCIALS_MODULE);

  // Get campaign details
  const campaigns = await socialsService.listAdCampaigns({
    id: data.ad_campaign_id,
  });

  if (campaigns.length === 0) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }

  const campaign = campaigns[0];

  // Get historical conversions for this campaign
  const conversions = await adPlanningService.listConversions({
    ad_campaign_id: data.ad_campaign_id,
  });

  // Build historical data points
  const dailyData: Record<string, { spend: number; conversions: number; revenue: number }> = {};

  for (const conv of conversions) {
    const dateKey = new Date(conv.converted_at).toISOString().split("T")[0];
    if (!dailyData[dateKey]) {
      dailyData[dateKey] = { spend: 0, conversions: 0, revenue: 0 };
    }
    dailyData[dateKey].conversions++;
    dailyData[dateKey].revenue += Number(conv.conversion_value) || 0;
  }

  // Add spend data from campaign
  const dailySpend = Number(campaign.daily_budget) || data.daily_budget;

  const historicalData = Object.entries(dailyData)
    .map(([dateStr, data]) => ({
      date: new Date(dateStr),
      spend: dailySpend,
      conversions: data.conversions,
      revenue: data.revenue,
    }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  // Generate forecast
  const forecastData = generateForecast(
    historicalData,
    data.forecast_days,
    data.daily_budget
  );

  // Get budget recommendation
  const budgetRec = recommendBudget(
    historicalData,
    data.target_roas || 3,
    data.daily_budget * 2
  );

  // Calculate totals
  const totalPredictedSpend = forecastData.reduce((sum, f) => sum + f.predicted_spend, 0);
  const totalPredictedRevenue = forecastData.reduce((sum, f) => sum + f.predicted_revenue, 0);
  const totalPredictedConversions = forecastData.reduce((sum, f) => sum + f.predicted_conversions, 0);

  // Calculate confidence level based on historical data
  const confidenceLevel = historicalData.length >= 30 ? 0.9 : historicalData.length >= 14 ? 0.7 : 0.5;

  // Save forecast
  const [forecast] = await adPlanningService.createBudgetForecasts([
    {
      ad_campaign_id: data.ad_campaign_id,
      forecast_level: "campaign" as const,
      forecast_date: new Date(), // Start date of forecast
      generated_at: new Date(),
      lookback_days: historicalData.length,
      predicted_spend: totalPredictedSpend,
      predicted_conversions: totalPredictedConversions,
      predicted_revenue: totalPredictedRevenue,
      predicted_roas: totalPredictedSpend > 0 ? totalPredictedRevenue / totalPredictedSpend : 0,
      confidence_intervals: {
        spend: { low: totalPredictedSpend * (1 - (1 - confidenceLevel)), high: totalPredictedSpend * (1 + (1 - confidenceLevel)) },
        conversions: { low: Math.floor(totalPredictedConversions * confidenceLevel), high: Math.ceil(totalPredictedConversions * (2 - confidenceLevel)) },
      },
      metadata: {
        forecast_period_start: new Date().toISOString(),
        forecast_period_end: new Date(Date.now() + data.forecast_days * 24 * 60 * 60 * 1000).toISOString(),
        forecast_days: data.forecast_days,
        model_type: "linear_trend_seasonal",
        confidence_level: confidenceLevel,
        daily_forecasts: forecastData,
        budget_recommendation: budgetRec,
        historical_data_points: historicalData.length,
      },
    },
  ]);

  res.status(201).json({
    forecast,
    daily_forecasts: forecastData,
    budget_recommendation: budgetRec,
    summary: {
      total_predicted_spend: totalPredictedSpend,
      total_predicted_revenue: totalPredictedRevenue,
      total_predicted_conversions: totalPredictedConversions,
      predicted_roas: totalPredictedSpend > 0
        ? Math.round((totalPredictedRevenue / totalPredictedSpend) * 100) / 100
        : 0,
    },
  });
};
