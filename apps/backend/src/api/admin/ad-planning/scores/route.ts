/**
 * Admin Customer Scores API
 * Manage NPS, engagement, and other customer scores
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { Modules } from "@medusajs/framework/utils";
import { z } from "@medusajs/framework/zod";
import { AD_PLANNING_MODULE } from "../../../../modules/ad-planning";
import { PERSON_MODULE } from "../../../../modules/person";
import { calculateNPSWorkflow } from "../../../../workflows/ad-planning/scoring/calculate-nps";
import { calculateEngagementWorkflow } from "../../../../workflows/ad-planning/scoring/calculate-engagement";
import { calculateCLVWorkflow } from "../../../../workflows/ad-planning/predictive/calculate-clv";
import { calculateChurnRiskWorkflow } from "../../../../workflows/ad-planning/predictive/calculate-churn-risk";

const ListScoresQuerySchema = z.object({
  person_id: z.string().optional(),
  score_type: z.enum(["nps", "engagement", "clv", "churn_risk"]).optional(),
  limit: z.coerce.number().default(50),
  offset: z.coerce.number().default(0),
});

const CalculateScoreSchema = z.object({
  person_id: z.string(),
  score_type: z.enum(["nps", "engagement", "clv", "churn_risk"]),
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
  const adPlanningService: any = req.scope.resolve(AD_PLANNING_MODULE);
  const personService: any = req.scope.resolve(PERSON_MODULE);

  const filters: Record<string, any> = {};
  if (params.person_id) filters.person_id = params.person_id;
  if (params.score_type) filters.score_type = params.score_type;

  const [scores, totalCount] = await adPlanningService.listAndCountCustomerScores(filters, {
    skip: params.offset,
    take: params.limit,
    order: { calculated_at: "DESC" },
  });

  // Fetch all scores (unbounded) for aggregates + percentile ranking
  const allScores = await adPlanningService.listCustomerScores(filters);

  // Build per-type sorted arrays so we can compute percentile for each score.
  // Percentile = what percent of the population has a value <= this score.
  const sortedByType: Record<string, number[]> = {};
  for (const s of allScores) {
    const type = s.score_type;
    const value = Number(s.score_value) || 0;
    if (!sortedByType[type]) sortedByType[type] = [];
    sortedByType[type].push(value);
  }
  for (const type in sortedByType) {
    sortedByType[type].sort((a, b) => a - b);
  }

  const computePercentile = (type: string, value: number): number | null => {
    const arr = sortedByType[type];
    if (!arr || arr.length === 0) return null;
    // Not meaningful with fewer than 2 data points
    if (arr.length < 2) return null;
    // Count how many values are <= this one (inclusive) for a standard percentile rank
    const count = arr.filter((v) => v <= value).length;
    return Math.round((count / arr.length) * 100);
  };

  // Infer a tier from the score type + value for display purposes
  const inferTier = (type: string, value: number): string | null => {
    if (type === "clv") {
      if (value >= 50000) return "platinum";
      if (value >= 20000) return "gold";
      if (value >= 5000) return "silver";
      return "bronze";
    }
    if (type === "engagement" || type === "nps") {
      if (value >= 75) return "high";
      if (value >= 40) return "medium";
      return "low";
    }
    if (type === "churn_risk") {
      if (value >= 70) return "high";
      if (value >= 40) return "medium";
      return "low";
    }
    return null;
  };

  // Join person data (first_name, last_name, email) for the paginated page only
  const personIds = Array.from(
    new Set((scores as any[]).map((s: any) => s.person_id).filter(Boolean))
  );
  const personsById = new Map<string, any>();
  if (personIds.length > 0) {
    try {
      const persons = await personService.listPeople({ id: personIds });
      for (const p of persons) {
        personsById.set(p.id, p);
      }
    } catch {
      // If the person module is unavailable, continue without enrichment
    }
  }

  // Also look up the Medusa Customer by email so we can fall back to customer
  // first/last name when a person record is missing or incomplete.
  const emails = Array.from(
    new Set(
      Array.from(personsById.values())
        .map((p: any) => p.email)
        .filter(Boolean)
    )
  );
  const customersByEmail = new Map<string, any>();
  if (emails.length > 0) {
    try {
      const customerService: any = req.scope.resolve(Modules.CUSTOMER);
      const customers = await customerService.listCustomers({ email: emails });
      for (const c of customers) {
        if (c.email) customersByEmail.set(c.email, c);
      }
    } catch {
      // Non-fatal — continue without customer enrichment
    }
  }

  // Enrich each score with person info, percentile, and tier.
  // Provides a `display_name` field the UI can render directly, trying
  // Person → Medusa Customer → email → truncated ID in that order.
  const enrichedScores = (scores as any[]).map((score: any) => {
    const person = personsById.get(score.person_id);
    const customer = person?.email ? customersByEmail.get(person.email) : null;
    const value = Number(score.score_value) || 0;

    const personFullName = [person?.first_name, person?.last_name]
      .filter(Boolean)
      .join(" ")
      .trim();
    const customerFullName = [customer?.first_name, customer?.last_name]
      .filter(Boolean)
      .join(" ")
      .trim();
    const display_name =
      personFullName ||
      customerFullName ||
      person?.email ||
      customer?.email ||
      null;

    return {
      ...score,
      percentile: computePercentile(score.score_type, value),
      tier: inferTier(score.score_type, value),
      display_name,
      person: person
        ? {
            id: person.id,
            first_name: person.first_name ?? null,
            last_name: person.last_name ?? null,
            email: person.email ?? null,
          }
        : null,
      customer: customer
        ? {
            id: customer.id,
            first_name: customer.first_name ?? null,
            last_name: customer.last_name ?? null,
            email: customer.email ?? null,
          }
        : null,
    };
  });

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
    scores: enrichedScores,
    aggregates,
    count: totalCount,
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
  } else if (data.score_type === "clv") {
    const result = await calculateCLVWorkflow(req.scope).run({
      input: {
        person_id: data.person_id,
      },
    });

    res.status(201).json({
      score_type: "clv",
      result: result.result,
    });
  } else if (data.score_type === "churn_risk") {
    const result = await calculateChurnRiskWorkflow(req.scope).run({
      input: {
        person_id: data.person_id,
      },
    });

    res.status(201).json({
      score_type: "churn_risk",
      result: result.result,
    });
  } else {
    res.status(400).json({ error: "Unsupported score type" });
  }
};
