/**
 * Admin Customer Scores API
 * Manage NPS, engagement, and other customer scores
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { z } from "@medusajs/framework/zod";
import { AD_PLANNING_MODULE } from "../../../../modules/ad-planning";
import { calculateNPSWorkflow } from "../../../../workflows/ad-planning/scoring/calculate-nps";
import { calculateEngagementWorkflow } from "../../../../workflows/ad-planning/scoring/calculate-engagement";

const ListScoresQuerySchema = z.object({
  person_id: z.string().optional(),
  score_type: z.enum(["nps", "engagement", "clv", "churn_risk"]).optional(),
  limit: z.coerce.number().default(50),
  offset: z.coerce.number().default(0),
});

const CalculateScoreSchema = z.object({
  person_id: z.string(),
  score_type: z.enum(["nps", "engagement"]),
  // For NPS
  rating: z.number().optional(),
  scale: z.enum(["5", "10"]).optional(),
  source_id: z.string().optional(),
  source_type: z.string().optional(),
});

/**
 * List customer scores
 * @route GET /admin/ad-planning/scores
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const params = ListScoresQuerySchema.parse(req.query);
  const adPlanningService = req.scope.resolve(AD_PLANNING_MODULE);

  const filters: Record<string, any> = {};
  if (params.person_id) filters.person_id = params.person_id;
  if (params.score_type) filters.score_type = params.score_type;

  const scores = await adPlanningService.listCustomerScores(filters, {
    skip: params.offset,
    take: params.limit,
    order: { calculated_at: "DESC" },
  });

  // Calculate aggregates
  const allScores = await adPlanningService.listCustomerScores(filters);

  const aggregates: Record<string, { count: number; avg: number; min: number; max: number }> = {};

  for (const score of allScores) {
    const type = score.score_type;
    if (!aggregates[type]) {
      aggregates[type] = { count: 0, avg: 0, min: Infinity, max: -Infinity };
    }
    aggregates[type].count++;
    aggregates[type].avg += Number(score.score_value) || 0;
    aggregates[type].min = Math.min(aggregates[type].min, Number(score.score_value) || 0);
    aggregates[type].max = Math.max(aggregates[type].max, Number(score.score_value) || 0);
  }

  for (const type in aggregates) {
    aggregates[type].avg = aggregates[type].count > 0
      ? Math.round((aggregates[type].avg / aggregates[type].count) * 100) / 100
      : 0;
    if (aggregates[type].min === Infinity) aggregates[type].min = 0;
    if (aggregates[type].max === -Infinity) aggregates[type].max = 0;
  }

  res.json({
    scores,
    aggregates,
    count: scores.length,
    offset: params.offset,
    limit: params.limit,
  });
};

/**
 * Calculate or record a score
 * @route POST /admin/ad-planning/scores
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const data = CalculateScoreSchema.parse(req.body);

  if (data.score_type === "nps") {
    if (!data.rating) {
      res.status(400).json({ error: "Rating is required for NPS calculation" });
      return;
    }

    const result = await calculateNPSWorkflow(req.scope).run({
      input: {
        person_id: data.person_id,
        rating: data.rating,
        scale: data.scale,
        source_id: data.source_id,
        source_type: data.source_type,
      },
    });

    res.status(201).json({
      score_type: "nps",
      result: result.result,
    });
  } else if (data.score_type === "engagement") {
    const result = await calculateEngagementWorkflow(req.scope).run({
      input: {
        person_id: data.person_id,
        recalculate: true,
      },
    });

    res.status(201).json({
      score_type: "engagement",
      result: result.result,
    });
  } else {
    res.status(400).json({ error: "Unsupported score type" });
  }
};
