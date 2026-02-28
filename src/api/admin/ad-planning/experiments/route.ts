/**
 * Admin A/B Experiments API
 * Manage A/B testing experiments
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { z } from "@medusajs/framework/zod";
import { AD_PLANNING_MODULE } from "../../../../modules/ad-planning";

const ListExperimentsQuerySchema = z.object({
  status: z.enum(["draft", "running", "paused", "completed"]).optional(),
  ad_campaign_id: z.string().optional(),
  website_id: z.string().optional(),
  limit: z.coerce.number().default(50),
  offset: z.coerce.number().default(0),
});

const CreateExperimentSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  website_id: z.string().nullable().optional(),
  experiment_type: z.enum(["ad_creative", "landing_page", "audience", "budget", "bidding"]).default("landing_page"),
  primary_metric: z.enum(["conversion_rate", "ctr", "cpc", "roas", "leads", "revenue"]).default("conversion_rate"),
  // Variants configuration - JSON array
  control_name: z.string().default("Control"),
  treatment_name: z.string().default("Treatment"),
  control_config: z.record(z.any()).optional(),
  treatment_config: z.record(z.any()).optional(),
  traffic_split: z.number().min(0).max(100).default(50),
  // Statistical settings
  target_sample_size: z.number().nullable().optional(),
  confidence_level: z.number().min(0).max(1).default(0.95),
  minimum_detectable_effect: z.number().nullable().optional(),
  // Additional metadata
  hypothesis: z.string().optional(),
  auto_stop: z.boolean().default(true),
});

/**
 * List experiments
 * @route GET /admin/ad-planning/experiments
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const params = ListExperimentsQuerySchema.parse(req.query);
  const adPlanningService = req.scope.resolve(AD_PLANNING_MODULE);

  const filters: Record<string, any> = {};
  if (params.status) filters.status = params.status;
  if (params.ad_campaign_id) filters.ad_campaign_id = params.ad_campaign_id;
  if (params.website_id) filters.website_id = params.website_id;

  const experiments = await adPlanningService.listABExperiments(filters, {
    skip: params.offset,
    take: params.limit,
    order: { created_at: "DESC" },
  });

  res.json({
    experiments,
    count: experiments.length,
    offset: params.offset,
    limit: params.limit,
  });
};

/**
 * Create experiment
 * @route POST /admin/ad-planning/experiments
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const data = CreateExperimentSchema.parse(req.body);
  const adPlanningService = req.scope.resolve(AD_PLANNING_MODULE);

  // Build variants JSON from input
  const variants = [
    {
      id: "control",
      name: data.control_name,
      weight: data.traffic_split,
      config: data.control_config || {},
    },
    {
      id: "treatment",
      name: data.treatment_name,
      weight: 100 - data.traffic_split,
      config: data.treatment_config || {},
    },
  ];

  const [experiment] = await adPlanningService.createABExperiments([
    {
      name: data.name,
      description: data.description,
      website_id: data.website_id,
      experiment_type: data.experiment_type,
      primary_metric: data.primary_metric,
      variants: variants as unknown as Record<string, unknown>,
      target_sample_size: data.target_sample_size,
      confidence_level: data.confidence_level,
      minimum_detectable_effect: data.minimum_detectable_effect,
      status: "draft" as const,
      results: {
        control: { conversions: 0, visitors: 0, rate: 0 },
        treatment: { conversions: 0, visitors: 0, rate: 0 },
      } as unknown as Record<string, unknown>,
      metadata: {
        hypothesis: data.hypothesis,
        auto_stop: data.auto_stop,
      },
    },
  ]);

  res.status(201).json({ experiment });
};
