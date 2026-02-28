/**
 * Admin Conversion Goal Detail API
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { z } from "@medusajs/framework/zod";
import { MedusaError } from "@medusajs/framework/utils";
import { AD_PLANNING_MODULE } from "../../../../../modules/ad-planning";

/**
 * Get goal by ID
 * @route GET /admin/ad-planning/goals/:id
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params;
  const adPlanningService = req.scope.resolve(AD_PLANNING_MODULE);

  const [goal] = await adPlanningService.listConversionGoals({ id });

  if (!goal) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Conversion goal with id ${id} not found`
    );
  }

  res.json({ goal });
};

const UpdateGoalSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional().nullable(),
  goal_type: z.enum([
    "lead_form",
    "purchase",
    "add_to_cart",
    "page_view",
    "time_on_page",
    "scroll_depth",
    "custom_event"
  ]).optional(),
  conditions: z.object({
    event_name: z.string().optional(),
    pathname_pattern: z.string().optional(),
    min_time_seconds: z.number().optional(),
    min_scroll_percent: z.number().optional(),
    custom_conditions: z.record(z.any()).optional(),
  }).optional(),
  default_value: z.number().optional().nullable(),
  value_from_event: z.boolean().optional(),
  is_active: z.boolean().optional(),
  priority: z.number().optional(),
  metadata: z.record(z.any()).optional().nullable(),
});

/**
 * Update goal
 * @route PUT /admin/ad-planning/goals/:id
 */
export const PUT = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params;
  const data = UpdateGoalSchema.parse(req.body);
  const adPlanningService = req.scope.resolve(AD_PLANNING_MODULE);

  const [existing] = await adPlanningService.listConversionGoals({ id });
  if (!existing) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Conversion goal with id ${id} not found`
    );
  }

  const goal = await adPlanningService.updateConversionGoals({
    id,
    ...data,
  });

  res.json({ goal });
};

/**
 * Delete goal
 * @route DELETE /admin/ad-planning/goals/:id
 */
export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params;
  const adPlanningService = req.scope.resolve(AD_PLANNING_MODULE);

  const [existing] = await adPlanningService.listConversionGoals({ id });
  if (!existing) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Conversion goal with id ${id} not found`
    );
  }

  await adPlanningService.deleteConversionGoals([id]);

  res.status(200).json({
    id,
    deleted: true,
  });
};
