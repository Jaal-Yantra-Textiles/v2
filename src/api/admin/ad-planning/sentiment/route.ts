/**
 * Admin Sentiment Analysis API
 * Analyze and list sentiment from customer feedback
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { z } from "@medusajs/framework/zod";
import { AD_PLANNING_MODULE } from "../../../../modules/ad-planning";
import { analyzeSentimentWorkflow } from "../../../../workflows/ad-planning/sentiment/analyze-sentiment";

const ListSentimentQuerySchema = z.object({
  source_type: z.enum(["feedback", "form_response", "social_mention", "social_comment", "review"]).optional(),
  sentiment_label: z.enum(["positive", "negative", "neutral", "mixed"]).optional(),
  person_id: z.string().optional(),
  website_id: z.string().optional(),
  from_date: z.string().optional(),
  to_date: z.string().optional(),
  limit: z.coerce.number().default(50),
  offset: z.coerce.number().default(0),
});

const AnalyzeSentimentSchema = z.object({
  text: z.string().min(1),
  source_type: z.enum(["feedback", "form_response", "social_mention", "social_comment", "review"]),
  source_id: z.string(),
  person_id: z.string().optional(),
  website_id: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});

/**
 * List sentiment analyses
 * @route GET /admin/ad-planning/sentiment
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const params = ListSentimentQuerySchema.parse(req.query);
  const adPlanningService = req.scope.resolve(AD_PLANNING_MODULE);

  const filters: Record<string, any> = {};
  if (params.source_type) filters.source_type = params.source_type;
  if (params.sentiment_label) filters.sentiment_label = params.sentiment_label;
  if (params.person_id) filters.person_id = params.person_id;
  if (params.website_id) filters.website_id = params.website_id;

  if (params.from_date || params.to_date) {
    filters.analyzed_at = {};
    if (params.from_date) filters.analyzed_at.$gte = new Date(params.from_date);
    if (params.to_date) filters.analyzed_at.$lte = new Date(params.to_date);
  }

  const sentiments = await adPlanningService.listSentimentAnalyses(filters, {
    skip: params.offset,
    take: params.limit,
    order: { analyzed_at: "DESC" },
  });

  // Calculate aggregate stats
  const allSentiments = await adPlanningService.listSentimentAnalyses(filters);

  const stats = {
    total: allSentiments.length,
    positive: allSentiments.filter((s: any) => s.sentiment_label === "positive").length,
    negative: allSentiments.filter((s: any) => s.sentiment_label === "negative").length,
    neutral: allSentiments.filter((s: any) => s.sentiment_label === "neutral").length,
    mixed: allSentiments.filter((s: any) => s.sentiment_label === "mixed").length,
    average_score: allSentiments.length > 0
      ? allSentiments.reduce((sum: number, s: any) => sum + (s.sentiment_score || 0), 0) / allSentiments.length
      : 0,
  };

  // Get top keywords
  const keywordCounts: Record<string, number> = {};
  for (const s of allSentiments) {
    const keywords = (s.keywords as string[] | null) || [];
    for (const keyword of keywords) {
      keywordCounts[keyword] = (keywordCounts[keyword] || 0) + 1;
    }
  }
  const topKeywords = Object.entries(keywordCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([keyword, count]) => ({ keyword, count }));

  // Get top emotions
  const emotionCounts: Record<string, number> = {};
  for (const s of allSentiments) {
    const emotions = (s.emotions as string[] | null) || [];
    for (const emotion of emotions) {
      emotionCounts[emotion] = (emotionCounts[emotion] || 0) + 1;
    }
  }
  const topEmotions = Object.entries(emotionCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([emotion, count]) => ({ emotion, count }));

  res.json({
    sentiments,
    stats: {
      ...stats,
      positive_rate: stats.total > 0 ? Math.round((stats.positive / stats.total) * 100) : 0,
      average_score: Math.round(stats.average_score * 100) / 100,
    },
    top_keywords: topKeywords,
    top_emotions: topEmotions,
    count: sentiments.length,
    offset: params.offset,
    limit: params.limit,
  });
};

/**
 * Analyze text sentiment
 * @route POST /admin/ad-planning/sentiment
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const data = AnalyzeSentimentSchema.parse(req.body);

  const result = await analyzeSentimentWorkflow(req.scope).run({
    input: data,
  });

  res.status(201).json({
    sentiment: result.result.sentiment,
    analysis: result.result.analysis,
  });
};
