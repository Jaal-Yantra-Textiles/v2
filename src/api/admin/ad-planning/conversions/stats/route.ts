/**
 * Admin Conversion Stats API
 * Get aggregated conversion statistics
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { z } from "zod";
import { AD_PLANNING_MODULE } from "../../../../../modules/ad-planning";

const StatsQuerySchema = z.object({
  website_id: z.string().optional(),
  ad_campaign_id: z.string().optional(),
  platform: z.enum(["meta", "google", "generic", "direct"]).optional(),
  from_date: z.string().optional(),
  to_date: z.string().optional(),
  group_by: z.enum(["day", "week", "month", "conversion_type", "platform", "campaign"]).default("day"),
});

/**
 * Get conversion statistics
 * @route GET /admin/ad-planning/conversions/stats
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const params = StatsQuerySchema.parse(req.query);
  const adPlanningService = req.scope.resolve(AD_PLANNING_MODULE);

  const filters: Record<string, any> = {};

  if (params.website_id) filters.website_id = params.website_id;
  if (params.ad_campaign_id) filters.ad_campaign_id = params.ad_campaign_id;
  if (params.platform) filters.platform = params.platform;

  // Date range
  const fromDate = params.from_date
    ? new Date(params.from_date)
    : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // Default 30 days
  const toDate = params.to_date ? new Date(params.to_date) : new Date();

  filters.converted_at = {
    $gte: fromDate,
    $lte: toDate,
  };

  // Get all conversions in range
  const conversions = await adPlanningService.listConversions(filters);

  // Calculate totals
  const totals = {
    total_conversions: conversions.length,
    total_value: conversions.reduce((sum, c) => sum + (Number(c.conversion_value) || 0), 0),
    by_type: {} as Record<string, number>,
    by_platform: {} as Record<string, number>,
  };

  // Group by type
  for (const conv of conversions) {
    totals.by_type[conv.conversion_type] = (totals.by_type[conv.conversion_type] || 0) + 1;
    totals.by_platform[conv.platform] = (totals.by_platform[conv.platform] || 0) + 1;
  }

  // Calculate time series based on group_by
  let timeSeries: any[] = [];

  if (params.group_by === "day" || params.group_by === "week" || params.group_by === "month") {
    const groupedByDate: Record<string, { count: number; value: number }> = {};

    for (const conv of conversions) {
      let dateKey: string;
      const date = new Date(conv.converted_at);

      if (params.group_by === "day") {
        dateKey = date.toISOString().split("T")[0];
      } else if (params.group_by === "week") {
        const weekStart = new Date(date);
        weekStart.setDate(date.getDate() - date.getDay());
        dateKey = weekStart.toISOString().split("T")[0];
      } else {
        dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      }

      if (!groupedByDate[dateKey]) {
        groupedByDate[dateKey] = { count: 0, value: 0 };
      }
      groupedByDate[dateKey].count++;
      groupedByDate[dateKey].value += Number(conv.conversion_value) || 0;
    }

    timeSeries = Object.entries(groupedByDate)
      .map(([date, data]) => ({ date, ...data }))
      .sort((a, b) => a.date.localeCompare(b.date));
  } else if (params.group_by === "conversion_type") {
    timeSeries = Object.entries(totals.by_type).map(([type, count]) => ({
      type,
      count,
      value: conversions
        .filter(c => c.conversion_type === type)
        .reduce((sum, c) => sum + (Number(c.conversion_value) || 0), 0),
    }));
  } else if (params.group_by === "platform") {
    timeSeries = Object.entries(totals.by_platform).map(([platform, count]) => ({
      platform,
      count,
      value: conversions
        .filter(c => c.platform === platform)
        .reduce((sum, c) => sum + (Number(c.conversion_value) || 0), 0),
    }));
  } else if (params.group_by === "campaign") {
    const byCampaign: Record<string, { count: number; value: number }> = {};
    for (const conv of conversions) {
      const campaignId = conv.ad_campaign_id || "unattributed";
      if (!byCampaign[campaignId]) {
        byCampaign[campaignId] = { count: 0, value: 0 };
      }
      byCampaign[campaignId].count++;
      byCampaign[campaignId].value += Number(conv.conversion_value) || 0;
    }
    timeSeries = Object.entries(byCampaign).map(([campaign_id, data]) => ({
      campaign_id,
      ...data,
    }));
  }

  res.json({
    totals,
    time_series: timeSeries,
    period: {
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
    },
  });
};
