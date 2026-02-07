/**
 * Admin Conversions API
 * List and create conversions
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { z } from "zod";
import { AD_PLANNING_MODULE } from "../../../../modules/ad-planning";

// Query params for listing
const ListConversionsSchema = z.object({
  website_id: z.string().optional(),
  conversion_type: z.string().optional(),
  ad_campaign_id: z.string().optional(),
  platform: z.enum(["meta", "google", "generic", "direct"]).optional(),
  visitor_id: z.string().optional(),
  person_id: z.string().optional(),
  from_date: z.string().optional(), // ISO date string
  to_date: z.string().optional(),
  limit: z.coerce.number().default(50),
  offset: z.coerce.number().default(0),
});

/**
 * List conversions with filtering
 * @route GET /admin/ad-planning/conversions
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const params = ListConversionsSchema.parse(req.query);
  const adPlanningService = req.scope.resolve(AD_PLANNING_MODULE);

  const filters: Record<string, any> = {};

  if (params.website_id) filters.website_id = params.website_id;
  if (params.conversion_type) filters.conversion_type = params.conversion_type;
  if (params.ad_campaign_id) filters.ad_campaign_id = params.ad_campaign_id;
  if (params.platform) filters.platform = params.platform;
  if (params.visitor_id) filters.visitor_id = params.visitor_id;
  if (params.person_id) filters.person_id = params.person_id;

  // Date range filtering
  if (params.from_date || params.to_date) {
    filters.converted_at = {};
    if (params.from_date) {
      filters.converted_at.$gte = new Date(params.from_date);
    }
    if (params.to_date) {
      filters.converted_at.$lte = new Date(params.to_date);
    }
  }

  const [conversions, count] = await adPlanningService.listAndCountConversions(
    filters,
    {
      take: params.limit,
      skip: params.offset,
      order: { converted_at: "DESC" },
    }
  );

  res.json({
    conversions,
    count,
    limit: params.limit,
    offset: params.offset,
  });
};

// Create conversion schema
const CreateConversionSchema = z.object({
  website_id: z.string().optional(),
  conversion_type: z.enum([
    "lead_form_submission",
    "add_to_cart",
    "begin_checkout",
    "purchase",
    "page_engagement",
    "scroll_depth",
    "time_on_site",
    "custom"
  ]),
  conversion_name: z.string().optional(),
  ad_campaign_id: z.string().optional(),
  ad_set_id: z.string().optional(),
  ad_id: z.string().optional(),
  platform: z.enum(["meta", "google", "generic", "direct"]).default("direct"),
  conversion_value: z.number().optional(),
  currency: z.string().default("INR"),
  order_id: z.string().optional(),
  lead_id: z.string().optional(),
  person_id: z.string().optional(),
  visitor_id: z.string(),
  session_id: z.string().optional(),
  utm_source: z.string().optional(),
  utm_medium: z.string().optional(),
  utm_campaign: z.string().optional(),
  converted_at: z.string().optional(), // ISO date string
  metadata: z.record(z.any()).optional(),
});

/**
 * Create a conversion manually
 * @route POST /admin/ad-planning/conversions
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const data = CreateConversionSchema.parse(req.body);
  const adPlanningService = req.scope.resolve(AD_PLANNING_MODULE);

  const [conversion] = await adPlanningService.createConversions([{
    ...data,
    converted_at: data.converted_at ? new Date(data.converted_at) : new Date(),
    attribution_model: "last_click",
  }]);

  res.status(201).json({ conversion });
};
