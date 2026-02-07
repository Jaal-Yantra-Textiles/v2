/**
 * Customer Journey Timeline API
 * Get full journey timeline for a customer
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { z } from "zod";
import { AD_PLANNING_MODULE } from "../../../../../modules/ad-planning";
import { PERSON_MODULE } from "../../../../../modules/person";

const TimelineQuerySchema = z.object({
  limit: z.coerce.number().default(100),
});

/**
 * Get customer journey timeline
 * @route GET /admin/ad-planning/journeys/:personId
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { personId } = req.params;
  const params = TimelineQuerySchema.parse(req.query);
  const adPlanningService = req.scope.resolve(AD_PLANNING_MODULE);
  const personService = req.scope.resolve(PERSON_MODULE);

  // Get person details
  const [person] = await (personService as any).listPeople({ id: personId });

  // Get all journey events
  const journeyEvents = await adPlanningService.listCustomerJourneys(
    { person_id: personId },
    { take: params.limit, order: { occurred_at: "ASC" } }
  );

  // Get conversions
  const conversions = await adPlanningService.listConversions(
    { person_id: personId },
    { order: { converted_at: "ASC" } }
  );

  // Get sentiment analyses
  const sentiments = await adPlanningService.listSentimentAnalyses(
    { person_id: personId },
    { order: { analyzed_at: "ASC" } }
  );

  // Get scores
  const scores = await adPlanningService.listCustomerScores({ person_id: personId });

  // Build unified timeline
  const timeline: Array<{
    timestamp: Date;
    type: string;
    stage: string;
    description: string;
    data: Record<string, any>;
  }> = [];

  // Add journey events
  for (const event of journeyEvents) {
    timeline.push({
      timestamp: new Date(event.occurred_at),
      type: "journey_event",
      stage: event.stage,
      description: `${event.event_type} event`,
      data: {
        event_type: event.event_type,
        event_data: event.event_data,
      },
    });
  }

  // Add conversions
  for (const conv of conversions) {
    timeline.push({
      timestamp: new Date(conv.converted_at),
      type: "conversion",
      stage: conv.conversion_type === "purchase" ? "conversion" : "intent",
      description: `${conv.conversion_type} conversion`,
      data: {
        conversion_type: conv.conversion_type,
        value: conv.conversion_value,
        order_id: conv.order_id,
      },
    });
  }

  // Add sentiment analyses
  for (const sentiment of sentiments) {
    const sentimentMetadata = sentiment.metadata as Record<string, any> | null;
    timeline.push({
      timestamp: new Date(sentiment.analyzed_at),
      type: "feedback",
      stage: "retention",
      description: `${sentiment.sentiment_label} feedback`,
      data: {
        sentiment_score: sentiment.sentiment_score,
        sentiment_label: sentiment.sentiment_label,
        summary: sentimentMetadata?.summary || null,
      },
    });
  }

  // Sort by timestamp
  timeline.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  // Calculate stage progression
  const stageOrder = ["awareness", "interest", "consideration", "intent", "conversion", "retention", "advocacy"];
  const stagesReached = new Set(timeline.map((t) => t.stage));
  const currentStageIndex = Math.max(...Array.from(stagesReached).map((s) => stageOrder.indexOf(s)));
  const currentStage = stageOrder[currentStageIndex] || "awareness";

  // Calculate time to conversion
  const firstEvent = timeline[0];
  const firstConversion = timeline.find((t) => t.stage === "conversion");
  const timeToConversion = firstEvent && firstConversion
    ? firstConversion.timestamp.getTime() - firstEvent.timestamp.getTime()
    : null;

  // Get current scores
  const npsScore = scores.find((s: any) => s.score_type === "nps");
  const engagementScore = scores.find((s: any) => s.score_type === "engagement");
  const clvScore = scores.find((s: any) => s.score_type === "clv");
  const churnRisk = scores.find((s: any) => s.score_type === "churn_risk");

  res.json({
    person: person
      ? {
          id: person.id,
          email: person.email,
          first_name: person.first_name,
          last_name: person.last_name,
        }
      : null,
    timeline,
    summary: {
      total_events: timeline.length,
      stages_reached: Array.from(stagesReached),
      current_stage: currentStage,
      first_interaction: firstEvent?.timestamp || null,
      latest_interaction: timeline[timeline.length - 1]?.timestamp || null,
      time_to_conversion: timeToConversion
        ? {
            ms: timeToConversion,
            days: Math.floor(timeToConversion / (24 * 60 * 60 * 1000)),
          }
        : null,
      total_conversions: conversions.length,
      total_purchase_value: conversions
        .filter((c: any) => c.conversion_type === "purchase")
        .reduce((sum: number, c: any) => sum + (Number(c.conversion_value) || 0), 0),
    },
    scores: {
      nps: npsScore ? Number(npsScore.score_value) : null,
      engagement: engagementScore ? Number(engagementScore.score_value) : null,
      clv: clvScore ? Number(clvScore.score_value) : null,
      churn_risk: churnRisk ? Number(churnRisk.score_value) : null,
    },
  });
};
