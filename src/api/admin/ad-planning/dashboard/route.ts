/**
 * Admin Ad Planning Dashboard API
 * Get comprehensive overview of ad performance and consumer insights
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { z } from "@medusajs/framework/zod";
import { AD_PLANNING_MODULE } from "../../../../modules/ad-planning";
import { SOCIALS_MODULE } from "../../../../modules/socials";

const DashboardQuerySchema = z.object({
  website_id: z.string().optional(),
  from_date: z.string().optional(),
  to_date: z.string().optional(),
  ad_account_id: z.string().optional(),
});

/**
 * Get dashboard overview
 * @route GET /admin/ad-planning/dashboard
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const params = DashboardQuerySchema.parse(req.query);
  const adPlanningService = req.scope.resolve(AD_PLANNING_MODULE);
  const socialsService = req.scope.resolve(SOCIALS_MODULE);

  const fromDate = params.from_date
    ? new Date(params.from_date)
    : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const toDate = params.to_date ? new Date(params.to_date) : new Date();

  // Build filters
  const dateFilter = {
    $gte: fromDate,
    $lte: toDate,
  };

  const conversionFilters: Record<string, any> = {
    converted_at: dateFilter,
  };
  if (params.website_id) conversionFilters.website_id = params.website_id;

  const attributionFilters: Record<string, any> = {
    attributed_at: dateFilter,
  };
  if (params.website_id) attributionFilters.website_id = params.website_id;

  // Fetch data in parallel
  const [
    conversions,
    attributions,
    segments,
    activeExperiments,
    campaigns,
  ] = await Promise.all([
    adPlanningService.listConversions(conversionFilters),
    adPlanningService.listCampaignAttributions(attributionFilters),
    adPlanningService.listCustomerSegments({ is_active: true }),
    adPlanningService.listABExperiments({ status: "running" }),
    params.ad_account_id
      ? socialsService.listAdCampaigns({ ad_account: { id: params.ad_account_id } })
      : [],
  ]);

  // Calculate conversion metrics
  const conversionMetrics = {
    total: conversions.length,
    total_value: conversions.reduce((sum, c) => sum + (Number(c.conversion_value) || 0), 0),
    by_type: {} as Record<string, { count: number; value: number }>,
    by_platform: {} as Record<string, { count: number; value: number }>,
  };

  for (const conv of conversions) {
    // By type
    if (!conversionMetrics.by_type[conv.conversion_type]) {
      conversionMetrics.by_type[conv.conversion_type] = { count: 0, value: 0 };
    }
    conversionMetrics.by_type[conv.conversion_type].count++;
    conversionMetrics.by_type[conv.conversion_type].value += Number(conv.conversion_value) || 0;

    // By platform
    if (!conversionMetrics.by_platform[conv.platform]) {
      conversionMetrics.by_platform[conv.platform] = { count: 0, value: 0 };
    }
    conversionMetrics.by_platform[conv.platform].count++;
    conversionMetrics.by_platform[conv.platform].value += Number(conv.conversion_value) || 0;
  }

  // Calculate attribution metrics
  const attributionMetrics = {
    total_sessions: attributions.length,
    resolved: attributions.filter(a => a.is_resolved).length,
    resolution_rate: attributions.length > 0
      ? (attributions.filter(a => a.is_resolved).length / attributions.length) * 100
      : 0,
    top_utm_sources: {} as Record<string, number>,
  };

  for (const attr of attributions) {
    if (attr.utm_source) {
      attributionMetrics.top_utm_sources[attr.utm_source] =
        (attributionMetrics.top_utm_sources[attr.utm_source] || 0) + 1;
    }
  }

  // Calculate ROI if we have campaign data
  const campaignROI: Array<{
    campaign_id: string;
    campaign_name: string;
    spend: number;
    conversions: number;
    revenue: number;
    roi: number;
  }> = [];

  for (const campaign of campaigns) {
    const campaignConversions = conversions.filter(c => c.ad_campaign_id === campaign.id);
    const revenue = campaignConversions.reduce((sum, c) => sum + (Number(c.conversion_value) || 0), 0);
    const spend = Number(campaign.spend) || 0;
    const roi = spend > 0 ? ((revenue - spend) / spend) * 100 : 0;

    campaignROI.push({
      campaign_id: campaign.id,
      campaign_name: campaign.name,
      spend,
      conversions: campaignConversions.length,
      revenue,
      roi: Math.round(roi * 100) / 100,
    });
  }

  // Daily trend
  const dailyTrend: Record<string, { conversions: number; value: number; sessions: number }> = {};

  for (const conv of conversions) {
    const dateKey = new Date(conv.converted_at).toISOString().split("T")[0];
    if (!dailyTrend[dateKey]) {
      dailyTrend[dateKey] = { conversions: 0, value: 0, sessions: 0 };
    }
    dailyTrend[dateKey].conversions++;
    dailyTrend[dateKey].value += Number(conv.conversion_value) || 0;
  }

  for (const attr of attributions) {
    const dateKey = new Date(attr.attributed_at).toISOString().split("T")[0];
    if (!dailyTrend[dateKey]) {
      dailyTrend[dateKey] = { conversions: 0, value: 0, sessions: 0 };
    }
    dailyTrend[dateKey].sessions++;
  }

  res.json({
    period: {
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
    },
    conversions: conversionMetrics,
    attribution: {
      ...attributionMetrics,
      top_sources: Object.entries(attributionMetrics.top_utm_sources)
        .map(([source, count]) => ({ source, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
    },
    segments: {
      total: segments.length,
      total_customers: segments.reduce((sum, s) => sum + (s.customer_count || 0), 0),
    },
    experiments: {
      active: activeExperiments.length,
      list: activeExperiments.map(e => ({
        id: e.id,
        name: e.name,
        status: e.status,
        primary_metric: e.primary_metric,
      })),
    },
    campaign_roi: campaignROI.sort((a, b) => b.roi - a.roi),
    daily_trend: Object.entries(dailyTrend)
      .map(([date, data]) => ({ date, ...data }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  });
};
