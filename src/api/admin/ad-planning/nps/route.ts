/**
 * Admin NPS API
 * Get NPS scores and trends
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { z } from "zod";
import { AD_PLANNING_MODULE } from "../../../../modules/ad-planning";

const NPSQuerySchema = z.object({
  from_date: z.string().optional(),
  to_date: z.string().optional(),
  segment_id: z.string().optional(),
});

/**
 * Get NPS score
 * @route GET /admin/ad-planning/nps
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const params = NPSQuerySchema.parse(req.query);
  const adPlanningService = req.scope.resolve(AD_PLANNING_MODULE);

  // Get all NPS scores
  const filters: Record<string, any> = {
    score_type: "nps",
  };

  if (params.from_date || params.to_date) {
    filters.calculated_at = {};
    if (params.from_date) filters.calculated_at.$gte = new Date(params.from_date);
    if (params.to_date) filters.calculated_at.$lte = new Date(params.to_date);
  }

  const scores = await adPlanningService.listCustomerScores(filters);

  if (scores.length === 0) {
    res.json({
      nps: {
        score: 0,
        promoters: 0,
        passives: 0,
        detractors: 0,
        total: 0,
      },
      trend: [],
    });
    return;
  }

  // Calculate overall NPS
  let promoters = 0;
  let passives = 0;
  let detractors = 0;

  for (const score of scores) {
    const npsValue = score.score_value;
    if (npsValue >= 9) {
      promoters++;
    } else if (npsValue >= 7) {
      passives++;
    } else {
      detractors++;
    }
  }

  const total = scores.length;
  const npsScore = Math.round(((promoters - detractors) / total) * 100);

  // Calculate trend by month
  const byMonth: Record<string, { promoters: number; passives: number; detractors: number }> = {};

  for (const score of scores) {
    const date = new Date(score.calculated_at);
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

    if (!byMonth[monthKey]) {
      byMonth[monthKey] = { promoters: 0, passives: 0, detractors: 0 };
    }

    const npsValue = score.score_value;
    if (npsValue >= 9) {
      byMonth[monthKey].promoters++;
    } else if (npsValue >= 7) {
      byMonth[monthKey].passives++;
    } else {
      byMonth[monthKey].detractors++;
    }
  }

  const trend = Object.entries(byMonth)
    .map(([month, data]) => {
      const total = data.promoters + data.passives + data.detractors;
      return {
        month,
        score: Math.round(((data.promoters - data.detractors) / total) * 100),
        ...data,
        total,
      };
    })
    .sort((a, b) => a.month.localeCompare(b.month));

  res.json({
    nps: {
      score: npsScore,
      promoters,
      passives,
      detractors,
      total,
      promoter_percentage: Math.round((promoters / total) * 100),
      passive_percentage: Math.round((passives / total) * 100),
      detractor_percentage: Math.round((detractors / total) * 100),
    },
    trend,
  });
};
