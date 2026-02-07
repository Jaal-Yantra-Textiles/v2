/**
 * Stop Experiment API
 * Stop/complete an A/B experiment
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { z } from "zod";
import { MedusaError } from "@medusajs/framework/utils";
import { AD_PLANNING_MODULE } from "../../../../../../modules/ad-planning";
import { calculateExperimentResults } from "../../../../../../modules/ad-planning/utils/statistical-utils";

const StopExperimentSchema = z.object({
  reason: z.string().optional(),
  winner: z.enum(["control", "treatment"]).optional(),
});

/**
 * Stop experiment
 * @route POST /admin/ad-planning/experiments/:id/stop
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params;
  const data = StopExperimentSchema.parse(req.body);
  const adPlanningService = req.scope.resolve(AD_PLANNING_MODULE);

  // Check experiment exists
  const [existing] = await adPlanningService.listABExperiments({ id });
  if (!existing) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Experiment ${id} not found`);
  }

  if (existing.status === "completed") {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Experiment is already completed");
  }

  if (existing.status === "draft") {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Experiment has not been started yet");
  }

  // Extract data from existing results JSON
  const existingResults = existing.results as Record<string, any> | null;
  const controlData = existingResults?.control || { conversions: 0, visitors: 0 };
  const treatmentData = existingResults?.treatment || { conversions: 0, visitors: 0 };

  // Calculate final results
  const results = calculateExperimentResults(
    controlData.conversions || 0,
    controlData.visitors || 0,
    treatmentData.conversions || 0,
    treatmentData.visitors || 0
  );

  // Determine winner
  const winner = data.winner || results.winner;

  // Sanitize NaN values for database storage
  const sanitizedPValue = Number.isNaN(results.pValue) ? null : results.pValue;
  const sanitizedLiftPercent = Number.isNaN(results.lift.liftPercent) || !Number.isFinite(results.lift.liftPercent)
    ? null
    : results.lift.liftPercent;

  const experiment = await adPlanningService.updateABExperiments({
    id,
    status: "completed" as const,
    ended_at: new Date(),
    is_significant: results.significance.confident,
    p_value: sanitizedPValue,
    improvement_percent: sanitizedLiftPercent,
    results: {
      ...existingResults,
      ...results,
      winner: winner !== "inconclusive" ? winner : null,
      stop_reason: data.reason || "manual_stop",
    },
  });

  res.json({
    experiment,
    results,
    message: "Experiment stopped and completed",
  });
};
