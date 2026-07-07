/**
 * Admin Budget Forecasts API
 * Generate and manage budget forecasts
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { z } from "@medusajs/framework/zod";
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

  // Use listAndCount so `count` is the true total, not the page size.
  const [forecasts, totalCount] =
    await adPlanningService.listAndCountBudgetForecasts(filters, {
      skip: params.offset,
      take: params.limit,
      order: { created_at: "DESC" },
    });

  res.json({
    forecasts,
    count: totalCount,
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

  // Resolve the campaign against Meta first, then Google Ads — the forecast
  // history + spend source differ by network:
  //   - Meta:   first-party Conversion rows + the campaign's flat daily_budget
  //   - Google: real per-day spend/conversions/revenue from stored GoogleAdsInsights
  type HistPoint = {
    date: Date;
    spend: number;
    conversions: number;
    revenue: number;
    impressions?: number;
    clicks?: number;
  };
  let adSource: "meta" | "google";
  let historicalData: HistPoint[];

  const metaCampaigns = await socialsService.listAdCampaigns({
    id: data.ad_campaign_id,
  });

  if (metaCampaigns.length > 0) {
    adSource = "meta";
    const campaign = metaCampaigns[0];

    const conversions = await adPlanningService.listConversions({
      ad_campaign_id: data.ad_campaign_id,
    });

    const dailyData: Record<string, { spend: number; conversions: number; revenue: number }> = {};
    for (const conv of conversions) {
      const dateKey = new Date(conv.converted_at).toISOString().split("T")[0];
      if (!dailyData[dateKey]) {
        dailyData[dateKey] = { spend: 0, conversions: 0, revenue: 0 };
      }
      dailyData[dateKey].conversions++;
      dailyData[dateKey].revenue += Number(conv.conversion_value) || 0;
    }

    const dailySpend = Number(campaign.daily_budget) || data.daily_budget;
    historicalData = Object.entries(dailyData)
      .map(([dateStr, d]) => ({
        date: new Date(dateStr),
        spend: dailySpend,
        conversions: d.conversions,
        revenue: d.revenue,
      }))
      .sort((a, b) => a.date.getTime() - b.date.getTime());
  } else {
    const googleCampaigns = await socialsService.listGoogleAdsCampaigns({
      id: data.ad_campaign_id,
    });
    if (googleCampaigns.length === 0) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }
    adSource = "google";

    // Real historical spend/performance from stored daily insights (base rows
    // only — device/network breakdown rows would double-count).
    const gInsights = await socialsService.listGoogleAdsInsights({
      level: "campaign",
      campaign_id: data.ad_campaign_id,
    });
    const dailyData: Record<string, { spend: number; conversions: number; revenue: number; impressions: number; clicks: number }> = {};
    for (const ins of gInsights) {
      if (ins.device != null || ins.network != null) continue;
      const dateKey = ins.date as string;
      if (!dateKey) continue;
      if (!dailyData[dateKey]) {
        dailyData[dateKey] = { spend: 0, conversions: 0, revenue: 0, impressions: 0, clicks: 0 };
      }
      dailyData[dateKey].spend += Number(ins.cost_micros) / 1_000_000;
      dailyData[dateKey].conversions += Number(ins.conversions) || 0;
      dailyData[dateKey].revenue += Number(ins.conversions_value) || 0;
      dailyData[dateKey].impressions += Number(ins.impressions) || 0;
      dailyData[dateKey].clicks += Number(ins.clicks) || 0;
    }
    historicalData = Object.entries(dailyData)
      .map(([dateStr, d]) => ({
        date: new Date(dateStr),
        spend: d.spend,
        conversions: d.conversions,
        revenue: d.revenue,
        impressions: d.impressions,
        clicks: d.clicks,
      }))
      .sort((a, b) => a.date.getTime() - b.date.getTime());
  }

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
      confidence_intervals: (() => {
        // Half-width of the interval = (1 - confidenceLevel). Lower confidence
        // → wider interval. The previous formula `(1 - (1 - confidenceLevel))`
        // simplified to `confidenceLevel`, giving the inverted behaviour.
        const margin = 1 - confidenceLevel;
        return {
          spend: {
            low: totalPredictedSpend * (1 - margin),
            high: totalPredictedSpend * (1 + margin),
          },
          conversions: {
            low: Math.floor(totalPredictedConversions * (1 - margin)),
            high: Math.ceil(totalPredictedConversions * (1 + margin)),
          },
        };
      })(),
      metadata: {
        forecast_period_start: new Date().toISOString(),
        forecast_period_end: new Date(Date.now() + data.forecast_days * 24 * 60 * 60 * 1000).toISOString(),
        forecast_days: data.forecast_days,
        model_type: "linear_trend_seasonal",
        ad_source: adSource,
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
