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
 * Step 3: Update customer engagement score if person exists
 */
const updateEngagementStep = createStep(
  "update-engagement-score",
  async (
    input: {
      person_id?: string;
      sentiment_score: number;
      source_type: string;
    },
    { container }
  ) => {
    if (!input.person_id) {
      return new StepResponse({ updated: false });
    }

    const adPlanningService: AdPlanningService = container.resolve(AD_PLANNING_MODULE);

    // Update engagement score based on feedback activity
    const existing = await adPlanningService.listCustomerScores({
      person_id: input.person_id,
      score_type: "engagement",
    });

    if (existing.length > 0) {
      // Increment engagement for providing feedback
      const currentScore = Number(existing[0].score_value) || 0;
      const feedbackBonus = 10; // +10 points for providing feedback
      const sentimentBonus = input.sentiment_score > 0 ? 5 : 0; // +5 for positive feedback
      const existingMetadata = (existing[0].metadata as Record<string, any>) || {};

      await adPlanningService.updateCustomerScores({
        id: existing[0].id,
        score_value: Math.min(100, currentScore + feedbackBonus + sentimentBonus),
        metadata: {
          ...existingMetadata,
          last_feedback_at: new Date().toISOString(),
          feedback_count: (existingMetadata.feedback_count || 0) + 1,
        },
        calculated_at: new Date(),
      });
    } else {
      // Create initial engagement score
      await adPlanningService.createCustomerScores([
        {
          person_id: input.person_id,
          score_type: "engagement" as const,
          score_value: 50 + (input.sentiment_score > 0 ? 10 : 0), // Base 50 + bonus
          metadata: {
            first_feedback_at: new Date().toISOString(),
            last_feedback_at: new Date().toISOString(),
            feedback_count: 1,
          },
          calculated_at: new Date(),
        },
      ]);
    }

    return new StepResponse({ updated: true });
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

    updateEngagementStep({
      person_id: input.person_id,
      sentiment_score: analysis.sentiment_score,
      source_type: input.source_type,
    });

    return new WorkflowResponse({
      sentiment,
      analysis,
    });
  }
);

export default analyzeSentimentWorkflow;
