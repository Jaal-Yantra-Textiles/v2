/**
 * Admin A/B Experiment Detail API
 * Get, update, delete individual experiments
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { z } from "@medusajs/framework/zod";
import { MedusaError } from "@medusajs/framework/utils";
import { AD_PLANNING_MODULE } from "../../../../../modules/ad-planning";

const UpdateExperimentSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  experiment_type: z.enum(["ad_creative", "landing_page", "audience", "budget", "bidding"]).optional(),
  variants: z.any().optional(), // JSON array of variants
  target_sample_size: z.number().nullable().optional(),
  confidence_level: z.number().min(0).max(1).optional(),
  minimum_detectable_effect: z.number().nullable().optional(),
  primary_metric: z.enum(["conversion_rate", "ctr", "cpc", "roas", "leads", "revenue"]).optional(),
  website_id: z.string().nullable().optional(),
  metadata: z.record(z.any()).nullable().optional(),
});

/**
 * Get experiment by ID
 * @route GET /admin/ad-planning/experiments/:id
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params;
  const adPlanningService = req.scope.resolve(AD_PLANNING_MODULE);

  const [experiment] = await adPlanningService.listABExperiments({ id });

  if (!experiment) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Experiment ${id} not found`);
  }

  res.json({ experiment });
};

/**
 * Update experiment
 * @route PUT /admin/ad-planning/experiments/:id
 */
export const PUT = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params;
  const data = UpdateExperimentSchema.parse(req.body);
  const adPlanningService = req.scope.resolve(AD_PLANNING_MODULE);

  // Check experiment exists and is not running
  const [existing] = await adPlanningService.listABExperiments({ id });
  if (!existing) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Experiment ${id} not found`);
  }

  if (existing.status === "running") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Cannot modify a running experiment. Pause it first."
    );
  }

  const experiment = await adPlanningService.updateABExperiments({
    id,
    ...data,
  });

  res.json({ experiment });
};

/**
 * Delete experiment
 * @route DELETE /admin/ad-planning/experiments/:id
 */
export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params;
  const adPlanningService = req.scope.resolve(AD_PLANNING_MODULE);

  // Check experiment exists
  const [existing] = await adPlanningService.listABExperiments({ id });
  if (!existing) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Experiment ${id} not found`);
  }

  if (existing.status === "running") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Cannot delete a running experiment. Stop it first."
    );
  }

  await adPlanningService.deleteABExperiments([id]);

  res.json({ id, deleted: true });
};
