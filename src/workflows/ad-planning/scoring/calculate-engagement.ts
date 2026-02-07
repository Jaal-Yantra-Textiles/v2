/**
 * Calculate Engagement Score Workflow
 *
 * Calculates customer engagement based on various activities.
 */

import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { AD_PLANNING_MODULE } from "../../../modules/ad-planning";
import type AdPlanningService from "../../../modules/ad-planning/service";
import { ANALYTICS_MODULE } from "../../../modules/analytics";

type CalculateEngagementInput = {
  person_id: string;
  recalculate?: boolean;
};

// Activity weights for engagement calculation
const ACTIVITY_WEIGHTS = {
  page_view: 1,
  session: 5,
  product_view: 3,
  add_to_cart: 10,
  begin_checkout: 15,
  purchase: 25,
  form_submit: 15,
  feedback: 20,
  social_share: 8,
  email_open: 2,
  email_click: 5,
};

/**
 * Step 1: Gather activity data
 */
const gatherActivityStep = createStep(
  "gather-activity",
  async (input: { person_id: string }, { container }) => {
    const adPlanningService: AdPlanningService = container.resolve(AD_PLANNING_MODULE);
    const analyticsService = container.resolve(ANALYTICS_MODULE);

    // Get conversions for this person
    const conversions = await adPlanningService.listConversions({
      person_id: input.person_id,
    });

    // Get sentiment analyses (feedback)
    const sentiments = await adPlanningService.listSentimentAnalyses({
      person_id: input.person_id,
    });

    // Get journey events
    const journeyEvents = await adPlanningService.listCustomerJourneys({
      person_id: input.person_id,
    });

    // Calculate time-based decay (more recent = higher weight)
    const now = Date.now();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;

    const activities: Array<{
      type: string;
      date: Date;
      value?: number;
    }> = [];

    // Add conversions as activities
    for (const conv of conversions) {
      activities.push({
        type: conv.conversion_type,
        date: new Date(conv.converted_at),
        value: Number(conv.conversion_value) || 0,
      });
    }

    // Add feedback as activities
    for (const sentiment of sentiments) {
      activities.push({
        type: "feedback",
        date: new Date(sentiment.analyzed_at),
        value: sentiment.sentiment_score > 0 ? 1 : 0, // Positive feedback bonus
      });
    }

    // Add journey events
    for (const event of journeyEvents) {
      activities.push({
        type: event.event_type,
        date: new Date(event.occurred_at),
      });
    }

    return new StepResponse({
      activities,
      total_activities: activities.length,
      has_recent_activity: activities.some(
        (a) => now - a.date.getTime() < thirtyDaysMs
      ),
    });
  }
);

/**
 * Step 2: Calculate engagement score
 */
const calculateScoreStep = createStep(
  "calculate-score",
  async (
    input: {
      activities: Array<{ type: string; date: Date; value?: number }>;
    },
    { container }
  ) => {
    const adPlanningService: AdPlanningService = container.resolve(AD_PLANNING_MODULE);

    const now = Date.now();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;

    let totalScore = 0;
    const breakdown: Record<string, number> = {};

    for (const activity of input.activities) {
      const ageMs = now - activity.date.getTime();
      let weight = ACTIVITY_WEIGHTS[activity.type as keyof typeof ACTIVITY_WEIGHTS] || 1;

      // Apply time decay
      if (ageMs < thirtyDaysMs) {
        // Recent activity: full weight
        weight *= 1.0;
      } else if (ageMs < ninetyDaysMs) {
        // 30-90 days: 50% weight
        weight *= 0.5;
      } else {
        // Older than 90 days: 25% weight
        weight *= 0.25;
      }

      // Special handling for purchase conversions (add value bonus)
      if (activity.type === "purchase" && activity.value && activity.value > 0) {
        weight += Math.log10(activity.value + 1) * 2;
      }

      totalScore += weight;
      breakdown[activity.type] = (breakdown[activity.type] || 0) + weight;
    }

    // Normalize to 0-100 scale
    // Assuming max reasonable score is ~500 for highly engaged customer
    const normalizedScore = Math.min(100, Math.round((totalScore / 5)));

    // Determine engagement level
    let level: "high" | "medium" | "low" | "inactive";
    if (normalizedScore >= 70) {
      level = "high";
    } else if (normalizedScore >= 40) {
      level = "medium";
    } else if (normalizedScore > 0) {
      level = "low";
    } else {
      level = "inactive";
    }

    return new StepResponse({
      raw_score: totalScore,
      normalized_score: normalizedScore,
      level,
      breakdown,
    });
  }
);

/**
 * Step 3: Save engagement score
 */
const saveEngagementScoreStep = createStep(
  "save-engagement-score",
  async (
    input: {
      person_id: string;
      score: number;
      level: string;
      breakdown: Record<string, number>;
      total_activities: number;
    },
    { container }
  ) => {
    const adPlanningService: AdPlanningService = container.resolve(AD_PLANNING_MODULE);

    // Check for existing engagement score
    const existing = await adPlanningService.listCustomerScores({
      person_id: input.person_id,
      score_type: "engagement",
    });

    const scoreData = {
      level: input.level,
      breakdown: input.breakdown,
      total_activities: input.total_activities,
      calculated_at: new Date().toISOString(),
    };

    if (existing.length > 0) {
      // Track score history
      const existingMetadata = existing[0].metadata as Record<string, any> | null;
      const history = existingMetadata?.score_history || [];
      history.push({
        score: input.score,
        date: new Date().toISOString(),
      });

      await adPlanningService.updateCustomerScores({
        id: existing[0].id,
        score_value: input.score,
        metadata: {
          ...scoreData,
          score_history: history.slice(-30), // Keep last 30 entries
          previous_score: existing[0].score_value,
          score_change: input.score - (Number(existing[0].score_value) || 0),
        },
        calculated_at: new Date(),
      });

      return new StepResponse({
        score_id: existing[0].id,
        is_new: false,
        previous_score: Number(existing[0].score_value) as number | null,
      });
    }

    // Create new engagement score
    const [score] = await adPlanningService.createCustomerScores([
      {
        person_id: input.person_id,
        score_type: "engagement" as const,
        score_value: input.score,
        metadata: {
          ...scoreData,
          score_history: [
            {
              score: input.score,
              date: new Date().toISOString(),
            },
          ],
        },
        calculated_at: new Date(),
      },
    ]);

    return new StepResponse({
      score_id: score.id,
      is_new: true,
      previous_score: null as number | null,
    });
  }
);

/**
 * Main workflow: Calculate engagement
 */
export const calculateEngagementWorkflow = createWorkflow(
  "calculate-engagement",
  (input: CalculateEngagementInput) => {
    const activity = gatherActivityStep({ person_id: input.person_id });

    const score = calculateScoreStep({
      activities: activity.activities,
    });

    const result = saveEngagementScoreStep({
      person_id: input.person_id,
      score: score.normalized_score,
      level: score.level,
      breakdown: score.breakdown,
      total_activities: activity.total_activities,
    } as any);

    return new WorkflowResponse({
      person_id: input.person_id,
      engagement_score: score.normalized_score,
      level: score.level,
      breakdown: score.breakdown as Record<string, number>,
      total_activities: activity.total_activities,
      is_new: (result as any).is_new,
      previous_score: (result as any).previous_score,
    });
  }
);

export default calculateEngagementWorkflow;
