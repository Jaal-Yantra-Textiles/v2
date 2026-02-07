/**
 * Experiment Results API
 * Get detailed statistical results for an experiment
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { MedusaError } from "@medusajs/framework/utils";
import { AD_PLANNING_MODULE } from "../../../../../../modules/ad-planning";
import {
  calculateExperimentResults,
  calculateRequiredSampleSize,
} from "../../../../../../modules/ad-planning/utils/statistical-utils";

/**
 * Get experiment results
 * @route GET /admin/ad-planning/experiments/:id/results
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params;
  const adPlanningService = req.scope.resolve(AD_PLANNING_MODULE);

  // Get experiment
  const [experiment] = await adPlanningService.listABExperiments({ id });
  if (!experiment) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Experiment ${id} not found`);
  }

  // Extract data from results JSON
  const experimentResults = experiment.results as Record<string, any> | null;
  const controlData = experimentResults?.control || { conversions: 0, visitors: 0, rate: 0 };
  const treatmentData = experimentResults?.treatment || { conversions: 0, visitors: 0, rate: 0 };

  // Calculate current results
  const results = calculateExperimentResults(
    controlData.conversions || 0,
    controlData.visitors || 0,
    treatmentData.conversions || 0,
    treatmentData.visitors || 0
  );

  // Calculate minimum sample size needed
  const baselineRate = results.control.rate || 0.01;
  const minimumDetectableEffect = experiment.minimum_detectable_effect || 0.1; // 10% improvement
  const requiredSampleSize = calculateRequiredSampleSize(
    baselineRate,
    minimumDetectableEffect
  );

  // Calculate progress
  const totalSamples = (controlData.visitors || 0) + (treatmentData.visitors || 0);
  const targetSamples = experiment.target_sample_size || requiredSampleSize * 2;
  const progress = targetSamples > 0 ? Math.min(100, (totalSamples / targetSamples) * 100) : 0;

  // Runtime stats
  const runtimeMs = experiment.started_at
    ? (experiment.ended_at || new Date()).getTime() - new Date(experiment.started_at).getTime()
    : 0;
  const runtimeDays = Math.floor(runtimeMs / (24 * 60 * 60 * 1000));
  const runtimeHours = Math.floor((runtimeMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));

  // Estimate time to significance
  let estimatedDaysToSignificance: number | null = null;
  if (experiment.status === "running" && !results.significance.confident) {
    const dailySampleRate = runtimeDays > 0 ? totalSamples / runtimeDays : totalSamples;
    const remainingSamples = targetSamples - totalSamples;
    estimatedDaysToSignificance = dailySampleRate > 0
      ? Math.ceil(remainingSamples / dailySampleRate)
      : null;
  }

  res.json({
    experiment: {
      id: experiment.id,
      name: experiment.name,
      status: experiment.status,
      primary_metric: experiment.primary_metric,
      started_at: experiment.started_at,
      ended_at: experiment.ended_at,
    },
    statistics: results,
    progress: {
      percent: Math.round(progress * 100) / 100,
      total_samples: totalSamples,
      target_samples: targetSamples,
      required_per_variant: requiredSampleSize,
    },
    runtime: {
      days: runtimeDays,
      hours: runtimeHours,
      total_ms: runtimeMs,
      estimated_days_to_significance: estimatedDaysToSignificance,
    },
    recommendation:
      results.significance.confident
        ? `Winner: ${results.winner} with ${results.lift.liftPercent}% lift`
        : experiment.status === "running"
        ? "Continue running to gather more data"
        : "Experiment needs more samples for significance",
  });
};
