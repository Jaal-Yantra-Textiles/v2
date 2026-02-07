/**
 * Admin Attribution Stats API
 * Get attribution statistics by campaign
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { z } from "zod";
import { AD_PLANNING_MODULE } from "../../../../../modules/ad-planning";

const StatsQuerySchema = z.object({
  website_id: z.string().optional(),
  from_date: z.string().optional(),
  to_date: z.string().optional(),
});

/**
 * Get attribution statistics
 * @route GET /admin/ad-planning/attribution/stats
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const params = StatsQuerySchema.parse(req.query);
  const adPlanningService = req.scope.resolve(AD_PLANNING_MODULE);

  const filters: Record<string, any> = {};

  if (params.website_id) filters.website_id = params.website_id;

  const fromDate = params.from_date
    ? new Date(params.from_date)
    : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const toDate = params.to_date ? new Date(params.to_date) : new Date();

  filters.attributed_at = {
    $gte: fromDate,
    $lte: toDate,
  };

  const attributions = await adPlanningService.listCampaignAttributions(filters);

  // Calculate stats
  const totalSessions = attributions.length;
  const resolvedSessions = attributions.filter(a => a.is_resolved).length;
  const unresolvedSessions = totalSessions - resolvedSessions;

  // By platform
  const byPlatform: Record<string, number> = {};
  // By campaign
  const byCampaign: Record<string, { sessions: number; pageviews: number }> = {};
  // By resolution method
  const byMethod: Record<string, number> = {};
  // By UTM source
  const byUtmSource: Record<string, number> = {};

  for (const attr of attributions) {
    // Platform
    byPlatform[attr.platform] = (byPlatform[attr.platform] || 0) + 1;

    // Campaign
    const campaignId = attr.ad_campaign_id || "unattributed";
    if (!byCampaign[campaignId]) {
      byCampaign[campaignId] = { sessions: 0, pageviews: 0 };
    }
    byCampaign[campaignId].sessions++;
    byCampaign[campaignId].pageviews += attr.session_pageviews || 1;

    // Resolution method
    byMethod[attr.resolution_method] = (byMethod[attr.resolution_method] || 0) + 1;

    // UTM source
    if (attr.utm_source) {
      byUtmSource[attr.utm_source] = (byUtmSource[attr.utm_source] || 0) + 1;
    }
  }

  res.json({
    totals: {
      total_sessions: totalSessions,
      resolved_sessions: resolvedSessions,
      unresolved_sessions: unresolvedSessions,
      resolution_rate: totalSessions > 0 ? (resolvedSessions / totalSessions) * 100 : 0,
    },
    by_platform: byPlatform,
    by_campaign: Object.entries(byCampaign)
      .map(([campaign_id, data]) => ({ campaign_id, ...data }))
      .sort((a, b) => b.sessions - a.sessions),
    by_resolution_method: byMethod,
    by_utm_source: Object.entries(byUtmSource)
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count),
    period: {
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
    },
  });
};
