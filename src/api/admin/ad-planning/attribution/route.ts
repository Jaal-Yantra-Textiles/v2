/**
 * Admin Attribution API
 * List and manage campaign attributions
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { z } from "zod";
import { AD_PLANNING_MODULE } from "../../../../modules/ad-planning";

const ListAttributionSchema = z.object({
  website_id: z.string().optional(),
  ad_campaign_id: z.string().optional(),
  platform: z.enum(["meta", "google", "generic"]).optional(),
  is_resolved: z.coerce.boolean().optional(),
  utm_campaign: z.string().optional(),
  from_date: z.string().optional(),
  to_date: z.string().optional(),
  limit: z.coerce.number().default(50),
  offset: z.coerce.number().default(0),
});

/**
 * List campaign attributions
 * @route GET /admin/ad-planning/attribution
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const params = ListAttributionSchema.parse(req.query);
  const adPlanningService = req.scope.resolve(AD_PLANNING_MODULE);

  const filters: Record<string, any> = {};

  if (params.website_id) filters.website_id = params.website_id;
  if (params.ad_campaign_id) filters.ad_campaign_id = params.ad_campaign_id;
  if (params.platform) filters.platform = params.platform;
  if (params.is_resolved !== undefined) filters.is_resolved = params.is_resolved;
  if (params.utm_campaign) filters.utm_campaign = params.utm_campaign;

  if (params.from_date || params.to_date) {
    filters.attributed_at = {};
    if (params.from_date) filters.attributed_at.$gte = new Date(params.from_date);
    if (params.to_date) filters.attributed_at.$lte = new Date(params.to_date);
  }

  const [attributions, count] = await adPlanningService.listAndCountCampaignAttributions(
    filters,
    {
      take: params.limit,
      skip: params.offset,
      order: { attributed_at: "DESC" },
    }
  );

  res.json({
    attributions,
    count,
    limit: params.limit,
    offset: params.offset,
  });
};

const CreateAttributionSchema = z.object({
  analytics_session_id: z.string(),
  visitor_id: z.string(),
  website_id: z.string(),
  ad_campaign_id: z.string().optional(),
  ad_set_id: z.string().optional(),
  ad_id: z.string().optional(),
  platform: z.enum(["meta", "google", "generic"]).default("meta"),
  utm_source: z.string().optional(),
  utm_medium: z.string().optional(),
  utm_campaign: z.string().optional(),
  utm_term: z.string().optional(),
  utm_content: z.string().optional(),
  is_resolved: z.boolean().default(false),
  resolution_method: z.enum(["exact_utm_match", "fuzzy_name_match", "manual", "unresolved"]).default("manual"),
  entry_page: z.string().optional(),
  session_pageviews: z.number().default(1),
  session_started_at: z.string(),
  metadata: z.record(z.any()).optional(),
});

/**
 * Create attribution manually
 * @route POST /admin/ad-planning/attribution
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const data = CreateAttributionSchema.parse(req.body);
  const adPlanningService = req.scope.resolve(AD_PLANNING_MODULE);

  const [attribution] = await adPlanningService.createCampaignAttributions([{
    ...data,
    attributed_at: new Date(),
    session_started_at: new Date(data.session_started_at),
    resolution_confidence: data.is_resolved ? 1.0 : 0,
  }]);

  res.status(201).json({ attribution });
};
