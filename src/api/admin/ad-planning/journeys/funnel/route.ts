/**
 * Customer Journey Funnel API
 * Analyze customer funnel progression
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { z } from "zod";
import { AD_PLANNING_MODULE } from "../../../../../modules/ad-planning";

const FunnelQuerySchema = z.object({
  website_id: z.string().optional(),
  from_date: z.string().optional(),
  to_date: z.string().optional(),
});

const STAGES = [
  "awareness",
  "interest",
  "consideration",
  "intent",
  "conversion",
  "retention",
  "advocacy",
];

/**
 * Get funnel analysis
 * @route GET /admin/ad-planning/journeys/funnel
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const params = FunnelQuerySchema.parse(req.query);
  const adPlanningService = req.scope.resolve(AD_PLANNING_MODULE);

  const filters: Record<string, any> = {};
  if (params.website_id) filters.website_id = params.website_id;

  if (params.from_date || params.to_date) {
    filters.occurred_at = {};
    if (params.from_date) filters.occurred_at.$gte = new Date(params.from_date);
    if (params.to_date) filters.occurred_at.$lte = new Date(params.to_date);
  }

  const journeys = await adPlanningService.listCustomerJourneys(filters);

  // Group by person and find their highest stage
  const personStages: Record<string, Set<string>> = {};

  for (const journey of journeys) {
    // Skip journeys without person_id
    if (!journey.person_id) continue;

    if (!personStages[journey.person_id]) {
      personStages[journey.person_id] = new Set();
    }
    personStages[journey.person_id].add(journey.stage);
  }

  // Calculate funnel metrics
  const funnelData: Array<{
    stage: string;
    count: number;
    percentage: number;
    dropoff_rate: number;
  }> = [];

  const totalCustomers = Object.keys(personStages).length;
  let previousCount = totalCustomers;

  for (const stage of STAGES) {
    // Count customers who reached this stage or higher
    const customersAtStage = Object.values(personStages).filter((stages) => {
      const stageIndex = STAGES.indexOf(stage);
      return Array.from(stages).some((s) => STAGES.indexOf(s) >= stageIndex);
    }).length;

    const percentage = totalCustomers > 0 ? (customersAtStage / totalCustomers) * 100 : 0;
    const dropoffRate = previousCount > 0
      ? ((previousCount - customersAtStage) / previousCount) * 100
      : 0;

    funnelData.push({
      stage,
      count: customersAtStage,
      percentage: Math.round(percentage * 100) / 100,
      dropoff_rate: Math.round(dropoffRate * 100) / 100,
    });

    previousCount = customersAtStage;
  }

  // Calculate conversion rates
  const awarenessCount = funnelData.find((f) => f.stage === "awareness")?.count || 0;
  const conversionCount = funnelData.find((f) => f.stage === "conversion")?.count || 0;

  const conversionRate = awarenessCount > 0
    ? (conversionCount / awarenessCount) * 100
    : 0;

  // Find biggest dropoff
  let biggestDropoff = { stage: "", rate: 0 };
  for (let i = 1; i < funnelData.length; i++) {
    if (funnelData[i].dropoff_rate > biggestDropoff.rate) {
      biggestDropoff = {
        stage: `${funnelData[i - 1].stage} → ${funnelData[i].stage}`,
        rate: funnelData[i].dropoff_rate,
      };
    }
  }

  // Stage-by-stage event breakdown
  const stageEvents: Record<string, Record<string, number>> = {};
  for (const stage of STAGES) {
    stageEvents[stage] = {};
  }

  for (const journey of journeys) {
    const stage = journey.stage;
    const eventType = journey.event_type;
    if (!stageEvents[stage][eventType]) {
      stageEvents[stage][eventType] = 0;
    }
    stageEvents[stage][eventType]++;
  }

  res.json({
    funnel: funnelData,
    summary: {
      total_customers: totalCustomers,
      awareness_to_conversion_rate: Math.round(conversionRate * 100) / 100,
      biggest_dropoff: biggestDropoff,
      avg_stages_per_customer:
        totalCustomers > 0
          ? Math.round(
              (Object.values(personStages).reduce((sum, stages) => sum + stages.size, 0) /
                totalCustomers) *
                100
            ) / 100
          : 0,
    },
    stage_events: stageEvents,
  });
};
