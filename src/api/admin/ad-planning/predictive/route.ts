/**
 * Admin Predictive Analytics API
 * Calculate and retrieve churn risk and CLV predictions
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { z } from "zod";
import { AD_PLANNING_MODULE } from "../../../../modules/ad-planning";
import { calculateChurnRiskWorkflow } from "../../../../workflows/ad-planning/predictive/calculate-churn-risk";
import { calculateCLVWorkflow } from "../../../../workflows/ad-planning/predictive/calculate-clv";

const ListPredictionsQuerySchema = z.object({
  person_id: z.string().optional(),
  score_type: z.enum(["churn_risk", "clv"]).optional(),
  risk_level: z.enum(["low", "medium", "high", "critical"]).optional(),
  tier: z.enum(["platinum", "gold", "silver", "bronze"]).optional(),
  limit: z.coerce.number().default(50),
  offset: z.coerce.number().default(0),
});

const CalculatePredictionSchema = z.object({
  person_id: z.string(),
  prediction_type: z.enum(["churn_risk", "clv", "all"]),
});

/**
 * List predictions
 * @route GET /admin/ad-planning/predictive
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const params = ListPredictionsQuerySchema.parse(req.query);
  const adPlanningService = req.scope.resolve(AD_PLANNING_MODULE);

  const filters: Record<string, any> = {};

  if (params.person_id) filters.person_id = params.person_id;
  if (params.score_type) {
    filters.score_type = params.score_type;
  } else {
    filters.score_type = { $in: ["churn_risk", "clv"] };
  }

  const scores = await adPlanningService.listCustomerScores(filters, {
    skip: params.offset,
    take: params.limit,
    order: { calculated_at: "DESC" },
  });

  // Filter by risk level or tier if specified
  let filteredScores = scores;
  if (params.risk_level) {
    filteredScores = scores.filter(
      (s: any) => s.score_data?.risk_level === params.risk_level
    );
  }
  if (params.tier) {
    filteredScores = scores.filter(
      (s: any) => s.score_data?.tier === params.tier
    );
  }

  // Calculate summary stats
  const allScores = await adPlanningService.listCustomerScores({
    score_type: { $in: ["churn_risk", "clv"] },
  });

  const churnScores = allScores.filter((s: any) => s.score_type === "churn_risk");
  const clvScores = allScores.filter((s: any) => s.score_type === "clv");

  const summary = {
    churn_risk: {
      total: churnScores.length,
      avg_score: churnScores.length > 0
        ? Math.round(
            churnScores.reduce((sum: number, s: any) => sum + Number(s.score_value), 0) /
              churnScores.length
          )
        : 0,
      by_level: {
        low: churnScores.filter((s: any) => s.score_data?.risk_level === "low").length,
        medium: churnScores.filter((s: any) => s.score_data?.risk_level === "medium").length,
        high: churnScores.filter((s: any) => s.score_data?.risk_level === "high").length,
        critical: churnScores.filter((s: any) => s.score_data?.risk_level === "critical").length,
      },
    },
    clv: {
      total: clvScores.length,
      avg_predicted: clvScores.length > 0
        ? Math.round(
            clvScores.reduce((sum: number, s: any) => sum + Number(s.score_value), 0) /
              clvScores.length
          )
        : 0,
      total_predicted: clvScores.reduce((sum: number, s: any) => sum + Number(s.score_value), 0),
      by_tier: {
        platinum: clvScores.filter((s: any) => s.score_data?.tier === "platinum").length,
        gold: clvScores.filter((s: any) => s.score_data?.tier === "gold").length,
        silver: clvScores.filter((s: any) => s.score_data?.tier === "silver").length,
        bronze: clvScores.filter((s: any) => s.score_data?.tier === "bronze").length,
      },
    },
  };

  res.json({
    predictions: filteredScores,
    summary,
    count: filteredScores.length,
    offset: params.offset,
    limit: params.limit,
  });
};

/**
 * Calculate predictions for a customer
 * @route POST /admin/ad-planning/predictive
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const data = CalculatePredictionSchema.parse(req.body);

  const results: Record<string, any> = {};

  if (data.prediction_type === "churn_risk" || data.prediction_type === "all") {
    const churnResult = await calculateChurnRiskWorkflow(req.scope).run({
      input: { person_id: data.person_id },
    });
    results.churn_risk = churnResult.result;
  }

  if (data.prediction_type === "clv" || data.prediction_type === "all") {
    const clvResult = await calculateCLVWorkflow(req.scope).run({
      input: { person_id: data.person_id },
    });
    results.clv = clvResult.result;
  }

  res.status(201).json({
    person_id: data.person_id,
    predictions: results,
  });
};
