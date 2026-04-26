/**
 * At-Risk Customers API
 * List customers with high churn risk
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { z } from "@medusajs/framework/zod";
import { AD_PLANNING_MODULE } from "../../../../../modules/ad-planning";
import { PERSON_MODULE } from "../../../../../modules/person";

const AtRiskQuerySchema = z.object({
  min_risk_score: z.coerce.number().default(50),
  limit: z.coerce.number().default(50),
});

/**
 * Get at-risk customers
 * @route GET /admin/ad-planning/predictive/at-risk
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const params = AtRiskQuerySchema.parse(req.query);
  const adPlanningService = req.scope.resolve(AD_PLANNING_MODULE);
  const personService = req.scope.resolve(PERSON_MODULE);

  // Get all churn risk scores above threshold
  const churnScores = await adPlanningService.listCustomerScores({
    score_type: "churn_risk",
  });

  const atRiskScores = churnScores
    .filter((s: any) => Number(s.score_value) >= params.min_risk_score)
    .sort((a: any, b: any) => Number(b.score_value) - Number(a.score_value))
    .slice(0, params.limit);

  // Get person details
  const personIds = atRiskScores.map((s: any) => s.person_id);
  const persons = personIds.length > 0
    ? await (personService as any).listPeople({ id: { $in: personIds } })
    : [];
  const personMap = new Map(persons.map((p: any) => [p.id, p]));

  // Get CLV scores for these persons
  const clvScores = personIds.length > 0
    ? await adPlanningService.listCustomerScores({
        person_id: { $in: personIds },
        score_type: "clv",
      })
    : [];
  const clvMap = new Map(clvScores.map((s: any) => [s.person_id, s]));

  // Build enriched list
  const atRiskCustomers = atRiskScores.map((score: any) => {
    const person = personMap.get(score.person_id) as any;
    const clv = clvMap.get(score.person_id);
    const scoreMetadata = score.metadata as Record<string, any> | null;
    const clvMetadata = clv?.metadata as Record<string, any> | null;

    return {
      person_id: score.person_id,
      person: person
        ? {
            email: person.email,
            first_name: person.first_name,
            last_name: person.last_name,
          }
        : null,
      churn_risk: {
        score: Number(score.score_value),
        level: scoreMetadata?.risk_level,
        contributing_factors: scoreMetadata?.contributing_factors,
        recommendations: scoreMetadata?.recommendations,
      },
      clv: clv
        ? {
            predicted: Number(clv.score_value),
            remaining: clvMetadata?.remaining_clv,
            tier: clvMetadata?.tier,
          }
        : null,
      priority:
        clv && Number(clv.score_value) > 10000
          ? "high_value_at_risk"
          : Number(score.score_value) >= 75
          ? "critical"
          : "standard",
    };
  });

  // Sort by priority (high-value at-risk first)
  atRiskCustomers.sort((a: any, b: any) => {
    if (a.priority === "high_value_at_risk" && b.priority !== "high_value_at_risk") return -1;
    if (b.priority === "high_value_at_risk" && a.priority !== "high_value_at_risk") return 1;
    return b.churn_risk.score - a.churn_risk.score;
  });

  // Calculate summary
  const summary = {
    total_at_risk: atRiskCustomers.length,
    critical_count: atRiskCustomers.filter((c: any) => c.churn_risk.level === "critical").length,
    high_value_at_risk: atRiskCustomers.filter((c: any) => c.priority === "high_value_at_risk").length,
    potential_revenue_at_risk: atRiskCustomers.reduce(
      (sum: number, c: any) => sum + (c.clv?.remaining || 0),
      0
    ),
  };

  res.json({
    at_risk_customers: atRiskCustomers,
    summary,
    count: atRiskCustomers.length,
  });
};
