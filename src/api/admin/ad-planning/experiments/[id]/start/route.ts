/**
 * Start Experiment API
 * Start an A/B experiment
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { MedusaError } from "@medusajs/framework/utils";
import { AD_PLANNING_MODULE } from "../../../../../../modules/ad-planning";

/**
 * Start experiment
 * @route POST /admin/ad-planning/experiments/:id/start
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params;
  const adPlanningService = req.scope.resolve(AD_PLANNING_MODULE);

  // Check experiment exists
  const [existing] = await adPlanningService.listABExperiments({ id });
  if (!existing) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Experiment ${id} not found`);
  }

  if (existing.status === "running") {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Experiment is already running");
  }

  if (existing.status === "completed") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Cannot restart a completed experiment. Create a new one."
    );
  }

  const experiment = await adPlanningService.updateABExperiments({
    id,
    status: "running" as const,
    started_at: new Date(),
  });

  res.json({
    experiment,
    message: "Experiment started successfully",
  });
};
