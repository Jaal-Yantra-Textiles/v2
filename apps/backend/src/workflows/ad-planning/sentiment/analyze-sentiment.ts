/**
 * Analyze Sentiment Workflow
 *
 * Uses AI to analyze sentiment from feedback, form responses, and social mentions.
 */

import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { AD_PLANNING_MODULE } from "../../../modules/ad-planning";
import type AdPlanningService from "../../../modules/ad-planning/service";
import { generateText } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";

type AnalyzeSentimentInput = {
  text: string;
  source_type: "feedback" | "form_response" | "social_mention" | "social_comment" | "review";
  source_id: string;
  person_id?: string;
  website_id?: string;
  metadata?: Record<string, any>;
};

type SentimentResult = {
  sentiment_score: number; // -1 to 1
  sentiment_label: "positive" | "negative" | "neutral" | "mixed";
  confidence: number;
  keywords: string[];
  entities: string[];
  emotions: string[];
  topics: string[];
  summary: string;
};

/**
 * Step 1: Analyze sentiment using AI
 */
const aiAnalyzeStep = createStep(
  "ai-analyze-sentiment",
  async (input: { text: string }, { container }) => {
    const openrouter = createOpenRouter({
      apiKey: process.env.OPENROUTER_API_KEY,
    });

    const prompt = `Analyze the sentiment of the following text and respond in JSON format only:

Text: "${input.text}"

Respond with a JSON object containing:
{
  "sentiment_score": <number between -1 (very negative) and 1 (very positive)>,
  "sentiment_label": <"positive" | "negative" | "neutral" | "mixed">,
  "confidence": <number between 0 and 1>,
  "keywords": [<array of key terms/phrases>],
  "entities": [<array of mentioned entities like people, brands, products>],
  "emotions": [<array of detected emotions like happy, frustrated, excited, disappointed>],
  "topics": [<array of main topics discussed>],
  "summary": "<brief 1-2 sentence summary of the feedback>"
}

Only respond with the JSON object, no other text.`;

    try {
      const result = await generateText({
        model: openrouter("anthropic/claude-3.5-sonnet"),
        prompt,
        maxOutputTokens: 500,
      });

      // Parse the JSON response
      const jsonStr = result.text.trim();
      const analysis = JSON.parse(jsonStr) as SentimentResult;

      return new StepResponse(analysis);
    } catch (error: any) {
      // Return neutral sentiment on error
      console.error("[SentimentAnalysis] AI error:", error.message);
      return new StepResponse({
        sentiment_score: 0,
        sentiment_label: "neutral" as const,
        confidence: 0.5,
        keywords: [],
        entities: [],
        emotions: [],
        topics: [],
        summary: "Unable to analyze sentiment",
      });
    }
  }
);

/**
 * Step 2: Save sentiment analysis result
 */
const saveSentimentStep = createStep(
  "save-sentiment",
  async (
    input: {
      analysis: SentimentResult;
      source_type: string;
      source_id: string;
      original_text: string;
      person_id?: string;
      website_id?: string;
      metadata?: Record<string, any>;
    },
    { container }
  ) => {
    const adPlanningService: AdPlanningService = container.resolve(AD_PLANNING_MODULE);

    const [sentiment] = await adPlanningService.createSentimentAnalyses([
      {
        source_type: input.source_type as "feedback" | "form_response" | "social_mention" | "social_comment" | "review",
        source_id: input.source_id,
        person_id: input.person_id,
        original_text: input.original_text,
        sentiment_score: input.analysis.sentiment_score,
        sentiment_label: input.analysis.sentiment_label as "very_negative" | "negative" | "neutral" | "positive" | "very_positive" | "mixed",
        confidence: input.analysis.confidence,
        keywords: input.analysis.keywords as unknown as Record<string, unknown>,
        entities: input.analysis.entities as unknown as Record<string, unknown>,
        emotions: input.analysis.emotions as unknown as Record<string, unknown>,
        topics: input.analysis.topics as unknown as Record<string, unknown>,
        analyzed_at: new Date(),
        metadata: {
          ...(input.metadata || {}),
          summary: input.analysis.summary,
          website_id: input.website_id,
        },
      },
    ]);

    return new StepResponse(sentiment, sentiment.id);
  },
  async (sentimentId, { container }) => {
    if (sentimentId) {
      const adPlanningService: AdPlanningService = container.resolve(AD_PLANNING_MODULE);
      await adPlanningService.deleteSentimentAnalyses([sentimentId]);
    }
  }
);

/**
 * Step 3: Recalculate engagement score from all activity data
 * Instead of patching +10/+15, we do a full recalculation so the score
 * stays consistent with calculateEngagementWorkflow.
 */
const recalculateEngagementStep = createStep(
  "recalculate-engagement-score",
  async (
    input: {
      person_id?: string;
    },
    { container }
  ) => {
    if (!input.person_id) {
      return new StepResponse({ updated: false });
    }

    try {
      const adPlanningService: AdPlanningService = container.resolve(AD_PLANNING_MODULE);

      // Gather all activity data — same logic as calculateEngagementWorkflow
      const conversions = await adPlanningService.listConversions({ person_id: input.person_id });
      const sentiments = await adPlanningService.listSentimentAnalyses({ person_id: input.person_id });
      const journeyEvents = await adPlanningService.listCustomerJourneys({ person_id: input.person_id });

      const ACTIVITY_WEIGHTS: Record<string, number> = {
        page_view: 1, session: 5, product_view: 3, add_to_cart: 10,
        begin_checkout: 15, purchase: 25, form_submit: 15, feedback: 20,
        social_share: 8, email_open: 2, email_click: 5,
      };

      const now = Date.now();
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
      const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;

      let totalScore = 0;
      const breakdown: Record<string, number> = {};

      const processActivity = (type: string, date: Date, value?: number) => {
        const ageMs = now - date.getTime();
        let weight = ACTIVITY_WEIGHTS[type] || 1;

        if (ageMs < thirtyDaysMs) weight *= 1.0;
        else if (ageMs < ninetyDaysMs) weight *= 0.5;
        else weight *= 0.25;

        if (type === "purchase" && value && value > 0) {
          weight += Math.log10(value + 1) * 2;
        }

        totalScore += weight;
        breakdown[type] = (breakdown[type] || 0) + weight;
      };

      for (const conv of conversions) {
        processActivity(conv.conversion_type, new Date(conv.converted_at), Number(conv.conversion_value) || 0);
      }
      for (const s of sentiments) {
        processActivity("feedback", new Date(s.analyzed_at), s.sentiment_score > 0 ? 1 : 0);
      }
      for (const event of journeyEvents) {
        processActivity(event.event_type, new Date(event.occurred_at));
      }

      const normalizedScore = Math.min(100, Math.round(totalScore / 5));

      let level: string;
      if (normalizedScore >= 70) level = "high";
      else if (normalizedScore >= 40) level = "medium";
      else if (normalizedScore > 0) level = "low";
      else level = "inactive";

      // Upsert engagement score
      const existing = await adPlanningService.listCustomerScores({
        person_id: input.person_id,
        score_type: "engagement",
      });

      const scoreData = { level, breakdown, calculated_at: new Date().toISOString() };

      if (existing.length > 0) {
        const existingMetadata = (existing[0].metadata as Record<string, any>) || {};
        const history = existingMetadata.score_history || [];
        history.push({ score: normalizedScore, date: new Date().toISOString() });

        await adPlanningService.updateCustomerScores({
          id: existing[0].id,
          score_value: normalizedScore,
          metadata: {
            ...scoreData,
            score_history: history.slice(-30),
            previous_score: existing[0].score_value,
            score_change: normalizedScore - (Number(existing[0].score_value) || 0),
          },
          calculated_at: new Date(),
        });
      } else {
        await adPlanningService.createCustomerScores([{
          person_id: input.person_id,
          score_type: "engagement" as const,
          score_value: normalizedScore,
          metadata: {
            ...scoreData,
            score_history: [{ score: normalizedScore, date: new Date().toISOString() }],
          },
          calculated_at: new Date(),
        }]);
      }

      return new StepResponse({ updated: true, score: normalizedScore, level });
    } catch (error) {
      console.error("[AdPlanning] Engagement recalculation failed:", error);
      return new StepResponse({ updated: false });
    }
  }
);

/**
 * Main workflow: Analyze sentiment
 */
export const analyzeSentimentWorkflow = createWorkflow(
  "analyze-sentiment",
  (input: AnalyzeSentimentInput) => {
    const analysis = aiAnalyzeStep({ text: input.text });

    const sentiment = saveSentimentStep({
      analysis,
      source_type: input.source_type,
      source_id: input.source_id,
      original_text: input.text,
      person_id: input.person_id,
      website_id: input.website_id,
      metadata: input.metadata,
    });

    recalculateEngagementStep({
      person_id: input.person_id,
    });

    return new WorkflowResponse({
      sentiment,
      analysis,
    });
  }
);

export default analyzeSentimentWorkflow;
