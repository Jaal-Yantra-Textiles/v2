/**
 * Admin Conversion Goals API
 * List and create conversion goals
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { z } from "@medusajs/framework/zod";
import { AD_PLANNING_MODULE } from "../../../../modules/ad-planning";

const ListGoalsSchema = z.object({
  website_id: z.string().optional(),
  goal_type: z.string().optional(),
  is_active: z.coerce.boolean().optional(),
  limit: z.coerce.number().default(50),
  offset: z.coerce.number().default(0),
});

/**
 * List conversion goals
 * @route GET /admin/ad-planning/goals
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const params = ListGoalsSchema.parse(req.query);
  const adPlanningService = req.scope.resolve(AD_PLANNING_MODULE);

  const filters: Record<string, any> = {};

  if (params.website_id) filters.website_id = params.website_id;
  if (params.goal_type) filters.goal_type = params.goal_type;
  if (params.is_active !== undefined) filters.is_active = params.is_active;

  const [goals, count] = await adPlanningService.listAndCountConversionGoals(
    filters,
    {
      take: params.limit,
      skip: params.offset,
      order: { priority: "DESC", created_at: "DESC" },
    }
  );

  res.json({
    goals,
    count,
    limit: params.limit,
    offset: params.offset,
  });
};

const CreateGoalSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  goal_type: z.enum([
    "lead_form",
    "purchase",
    "add_to_cart",
    "page_view",
    "time_on_page",
    "scroll_depth",
    "custom_event"
  ]),
  conditions: z.object({
    event_name: z.string().optional(),
    pathname_pattern: z.string().optional(),
    min_time_seconds: z.number().optional(),
    min_scroll_percent: z.number().optional(),
    custom_conditions: z.record(z.any()).optional(),
  }),
  default_value: z.number().optional(),
  value_from_event: z.boolean().default(false),
  is_active: z.boolean().default(true),
  website_id: z.string().optional(),
  priority: z.number().default(0),
  metadata: z.record(z.any()).optional(),
});

/**
 * Create a conversion goal
 * @route POST /admin/ad-planning/goals
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const data = CreateGoalSchema.parse(req.body);
  const adPlanningService = req.scope.resolve(AD_PLANNING_MODULE);

  const [goal] = await adPlanningService.createConversionGoals([data]);

  res.status(201).json({ goal });
};
