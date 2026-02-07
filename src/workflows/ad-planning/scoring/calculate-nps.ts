/**
 * Calculate NPS Workflow
 *
 * Calculates Net Promoter Score from customer feedback.
 */

import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { AD_PLANNING_MODULE } from "../../../modules/ad-planning";
import type AdPlanningService from "../../../modules/ad-planning/service";

type CalculateNPSInput = {
  person_id: string;
  rating: number; // 1-5 scale or 0-10 scale
  scale?: "5" | "10";
  source_id?: string;
  source_type?: string;
};

/**
 * Step 1: Normalize rating to NPS scale (0-10)
 */
const normalizeRatingStep = createStep(
  "normalize-rating",
  async (input: { rating: number; scale?: "5" | "10" }) => {
    let npsValue: number;

    if (input.scale === "5" || input.rating <= 5) {
      // Convert 1-5 to 0-10
      // 1 → 2, 2 → 4, 3 → 6, 4 → 8, 5 → 10
      npsValue = Math.round(input.rating * 2);
    } else {
      // Already 0-10 scale
      npsValue = Math.round(input.rating);
    }

    // Clamp to valid range
    npsValue = Math.max(0, Math.min(10, npsValue));

    // Determine category
    let category: "promoter" | "passive" | "detractor";
    if (npsValue >= 9) {
      category = "promoter";
    } else if (npsValue >= 7) {
      category = "passive";
    } else {
      category = "detractor";
    }

    return new StepResponse({ nps_value: npsValue, category });
  }
);

/**
 * Step 2: Save or update NPS score
 */
const saveNPSScoreStep = createStep(
  "save-nps-score",
  async (
    input: {
      person_id: string;
      nps_value: number;
      category: "promoter" | "passive" | "detractor";
      source_id?: string;
      source_type?: string;
    },
    { container }
  ) => {
    const adPlanningService: AdPlanningService = container.resolve(AD_PLANNING_MODULE);

    // Check for existing NPS score
    const existing = await adPlanningService.listCustomerScores({
      person_id: input.person_id,
      score_type: "nps",
    });

    const scoreData = {
      current_category: input.category,
      last_rating: input.nps_value,
      last_source_id: input.source_id,
      last_source_type: input.source_type,
      updated_at: new Date().toISOString(),
    };

    if (existing.length > 0) {
      // Update existing - keep history
      const existingMetadata = (existing[0].metadata as Record<string, any>) || {};
      const history = existingMetadata.history || [];
      history.push({
        score: input.nps_value,
        category: input.category,
        date: new Date().toISOString(),
      });

      // Calculate average
      const allScores = history.map((h: any) => h.score);
      const averageScore = allScores.reduce((a: number, b: number) => a + b, 0) / allScores.length;

      await adPlanningService.updateCustomerScores({
        id: existing[0].id,
        score_value: averageScore,
        metadata: {
          ...scoreData,
          history: history.slice(-10), // Keep last 10 entries
          total_responses: history.length,
        },
        calculated_at: new Date(),
      });

      return new StepResponse({
        score_id: existing[0].id,
        average_score: averageScore,
        is_new: false,
      });
    }

    // Create new NPS score
    const [score] = await adPlanningService.createCustomerScores([
      {
        person_id: input.person_id,
        score_type: "nps" as const,
        score_value: input.nps_value,
        metadata: {
          ...scoreData,
          history: [
            {
              score: input.nps_value,
              category: input.category,
              date: new Date().toISOString(),
            },
          ],
          total_responses: 1,
        },
        calculated_at: new Date(),
      },
    ]);

    return new StepResponse({
      score_id: score.id,
      average_score: input.nps_value,
      is_new: true,
    });
  }
);

/**
 * Main workflow: Calculate NPS
 */
export const calculateNPSWorkflow = createWorkflow(
  "calculate-nps",
  (input: CalculateNPSInput) => {
    const normalized = normalizeRatingStep({
      rating: input.rating,
      scale: input.scale,
    });

    const result = saveNPSScoreStep({
      person_id: input.person_id,
      nps_value: normalized.nps_value,
      category: normalized.category,
      source_id: input.source_id,
      source_type: input.source_type,
    });

    return new WorkflowResponse({
      person_id: input.person_id,
      nps_value: normalized.nps_value,
      category: normalized.category,
      average_score: result.average_score,
      is_new: result.is_new,
    });
  }
);

export default calculateNPSWorkflow;
