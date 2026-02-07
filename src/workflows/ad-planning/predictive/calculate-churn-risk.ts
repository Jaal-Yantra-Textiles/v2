/**
 * Calculate Churn Risk Workflow
 *
 * Predicts customer churn risk based on behavioral signals.
 */

import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { AD_PLANNING_MODULE } from "../../../modules/ad-planning";
import type AdPlanningService from "../../../modules/ad-planning/service";

type CalculateChurnRiskInput = {
  person_id: string;
};

// Churn risk factors and weights
const CHURN_FACTORS = {
  days_since_last_activity: { weight: 0.3, threshold: 30 },
  days_since_last_purchase: { weight: 0.25, threshold: 60 },
  engagement_score_decline: { weight: 0.2, threshold: 20 },
  negative_sentiment_ratio: { weight: 0.15, threshold: 0.3 },
  support_ticket_increase: { weight: 0.1, threshold: 3 },
};

/**
 * Step 1: Gather customer activity data
 */
const gatherActivityDataStep = createStep(
  "gather-activity-data",
  async (input: { person_id: string }, { container }) => {
    const adPlanningService: AdPlanningService = container.resolve(AD_PLANNING_MODULE);
    const now = new Date();

    // Get journey events (recent activity)
    const journeyEvents = await adPlanningService.listCustomerJourneys({
      person_id: input.person_id,
    });

    // Get conversions
    const conversions = await adPlanningService.listConversions({
      person_id: input.person_id,
    });

    // Get sentiment analyses
    const sentiments = await adPlanningService.listSentimentAnalyses({
      person_id: input.person_id,
    });

    // Get existing scores
    const scores = await adPlanningService.listCustomerScores({
      person_id: input.person_id,
    });

    // Calculate metrics
    const lastActivity = journeyEvents.length > 0
      ? new Date(Math.max(...journeyEvents.map((e: any) => new Date(e.occurred_at).getTime())))
      : null;

    const lastPurchase = conversions
      .filter((c: any) => c.conversion_type === "purchase")
      .sort((a: any, b: any) => new Date(b.converted_at).getTime() - new Date(a.converted_at).getTime())[0];

    const daysSinceLastActivity = lastActivity
      ? Math.floor((now.getTime() - lastActivity.getTime()) / (24 * 60 * 60 * 1000))
      : 365;

    const daysSinceLastPurchase = lastPurchase
      ? Math.floor((now.getTime() - new Date(lastPurchase.converted_at).getTime()) / (24 * 60 * 60 * 1000))
      : 365;

    // Get engagement score history
    const engagementScore = scores.find((s: any) => s.score_type === "engagement");
    const engagementMetadata = engagementScore?.metadata as Record<string, any> | null;
    const engagementHistory = engagementMetadata?.score_history || [];
    let engagementDecline = 0;

    if (engagementHistory.length >= 2) {
      const recent = engagementHistory.slice(-3).map((h: any) => h.score);
      const earlier = engagementHistory.slice(0, 3).map((h: any) => h.score);
      const recentAvg = recent.reduce((a: number, b: number) => a + b, 0) / recent.length;
      const earlierAvg = earlier.reduce((a: number, b: number) => a + b, 0) / earlier.length;
      engagementDecline = earlierAvg > 0 ? ((earlierAvg - recentAvg) / earlierAvg) * 100 : 0;
    }

    // Calculate negative sentiment ratio (last 30 days)
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const recentSentiments = sentiments.filter(
      (s: any) => new Date(s.analyzed_at) >= thirtyDaysAgo
    );
    const negativeSentiments = recentSentiments.filter(
      (s: any) => s.sentiment_label === "negative"
    );
    const negativeSentimentRatio = recentSentiments.length > 0
      ? negativeSentiments.length / recentSentiments.length
      : 0;

    return new StepResponse({
      days_since_last_activity: daysSinceLastActivity,
      days_since_last_purchase: daysSinceLastPurchase,
      engagement_score_decline: engagementDecline,
      negative_sentiment_ratio: negativeSentimentRatio,
      total_purchases: conversions.filter((c: any) => c.conversion_type === "purchase").length,
      current_engagement: engagementScore ? Number(engagementScore.score_value) : 0,
    });
  }
);

/**
 * Step 2: Calculate churn risk score
 */
const calculateRiskScoreStep = createStep(
  "calculate-risk-score",
  async (
    input: {
      days_since_last_activity: number;
      days_since_last_purchase: number;
      engagement_score_decline: number;
      negative_sentiment_ratio: number;
      total_purchases: number;
      current_engagement: number;
    }
  ) => {
    let riskScore = 0;

    // Days since last activity factor
    const activityRisk = Math.min(
      1,
      input.days_since_last_activity / (CHURN_FACTORS.days_since_last_activity.threshold * 3)
    );
    riskScore += activityRisk * CHURN_FACTORS.days_since_last_activity.weight;

    // Days since last purchase factor
    const purchaseRisk = Math.min(
      1,
      input.days_since_last_purchase / (CHURN_FACTORS.days_since_last_purchase.threshold * 3)
    );
    riskScore += purchaseRisk * CHURN_FACTORS.days_since_last_purchase.weight;

    // Engagement decline factor
    const engagementRisk = Math.min(
      1,
      Math.max(0, input.engagement_score_decline) / 100
    );
    riskScore += engagementRisk * CHURN_FACTORS.engagement_score_decline.weight;

    // Negative sentiment factor
    riskScore += input.negative_sentiment_ratio * CHURN_FACTORS.negative_sentiment_ratio.weight;

    // Adjust for customer value (high-value customers need different treatment)
    let valueAdjustment = 0;
    if (input.total_purchases > 5) {
      // Loyal customer - slightly lower baseline risk
      valueAdjustment = -0.05;
    } else if (input.total_purchases === 0) {
      // Never purchased - higher risk
      valueAdjustment = 0.1;
    }

    riskScore = Math.max(0, Math.min(1, riskScore + valueAdjustment));

    // Convert to 0-100 scale
    const normalizedScore = Math.round(riskScore * 100);

    // Determine risk level
    let riskLevel: "low" | "medium" | "high" | "critical";
    if (normalizedScore >= 75) {
      riskLevel = "critical";
    } else if (normalizedScore >= 50) {
      riskLevel = "high";
    } else if (normalizedScore >= 25) {
      riskLevel = "medium";
    } else {
      riskLevel = "low";
    }

    // Generate recommendations
    const recommendations: string[] = [];
    if (input.days_since_last_activity > 30) {
      recommendations.push("Send re-engagement email campaign");
    }
    if (input.days_since_last_purchase > 60) {
      recommendations.push("Offer personalized discount or incentive");
    }
    if (input.engagement_score_decline > 20) {
      recommendations.push("Reach out for feedback on experience");
    }
    if (input.negative_sentiment_ratio > 0.3) {
      recommendations.push("Prioritize support outreach to address concerns");
    }

    return new StepResponse({
      risk_score: normalizedScore,
      risk_level: riskLevel,
      contributing_factors: {
        activity_risk: Math.round(activityRisk * 100),
        purchase_risk: Math.round(purchaseRisk * 100),
        engagement_risk: Math.round(engagementRisk * 100),
        sentiment_risk: Math.round(input.negative_sentiment_ratio * 100),
      },
      recommendations,
    });
  }
);

// Type for save churn risk result
type SaveChurnRiskResult = {
  score_id: string;
  is_new: boolean;
  previous_score: number | null;
};

/**
 * Step 3: Save churn risk score
 */
const saveChurnRiskStep = createStep(
  "save-churn-risk",
  async (
    input: {
      person_id: string;
      risk_score: number;
      risk_level: string;
      contributing_factors: Record<string, number>;
      recommendations: string[];
    },
    { container }
  ): Promise<StepResponse<SaveChurnRiskResult, SaveChurnRiskResult>> => {
    const adPlanningService: AdPlanningService = container.resolve(AD_PLANNING_MODULE);

    // Check for existing churn risk score
    const existing = await adPlanningService.listCustomerScores({
      person_id: input.person_id,
      score_type: "churn_risk",
    });

    const scoreData = {
      risk_level: input.risk_level,
      contributing_factors: input.contributing_factors,
      recommendations: input.recommendations,
      calculated_at: new Date().toISOString(),
    };

    if (existing.length > 0) {
      // Track history
      const existingMetadata = existing[0].metadata as Record<string, any> | null;
      const history = existingMetadata?.history || [];
      history.push({
        score: input.risk_score,
        level: input.risk_level,
        date: new Date().toISOString(),
      });

      await adPlanningService.updateCustomerScores({
        id: existing[0].id,
        score_value: input.risk_score,
        metadata: {
          ...scoreData,
          history: history.slice(-30),
          previous_score: existing[0].score_value,
          score_change: input.risk_score - (Number(existing[0].score_value) || 0),
        },
        calculated_at: new Date(),
      });

      const updateResult: SaveChurnRiskResult = {
        score_id: existing[0].id,
        is_new: false,
        previous_score: Number(existing[0].score_value) || null,
      };
      return new StepResponse(updateResult);
    }

    // Create new score
    const [score] = await adPlanningService.createCustomerScores([
      {
        person_id: input.person_id,
        score_type: "churn_risk",
        score_value: input.risk_score,
        metadata: {
          ...scoreData,
          history: [
            {
              score: input.risk_score,
              level: input.risk_level,
              date: new Date().toISOString(),
            },
          ],
        },
        calculated_at: new Date(),
      },
    ]);

    const createResult: SaveChurnRiskResult = {
      score_id: score.id,
      is_new: true,
      previous_score: null,
    };
    return new StepResponse(createResult);
  }
);

/**
 * Main workflow: Calculate churn risk
 */
export const calculateChurnRiskWorkflow = createWorkflow(
  "calculate-churn-risk",
  (input: CalculateChurnRiskInput) => {
    const activityData = gatherActivityDataStep({ person_id: input.person_id } as any);

    const riskCalculation = calculateRiskScoreStep({
      days_since_last_activity: (activityData as any).days_since_last_activity,
      days_since_last_purchase: (activityData as any).days_since_last_purchase,
      engagement_score_decline: (activityData as any).engagement_score_decline,
      negative_sentiment_ratio: (activityData as any).negative_sentiment_ratio,
      total_purchases: (activityData as any).total_purchases,
      current_engagement: (activityData as any).current_engagement,
    } as any);

    const result = saveChurnRiskStep({
      person_id: input.person_id,
      risk_score: (riskCalculation as any).risk_score,
      risk_level: (riskCalculation as any).risk_level,
      contributing_factors: (riskCalculation as any).contributing_factors,
      recommendations: (riskCalculation as any).recommendations,
    } as any);

    return new WorkflowResponse({
      person_id: input.person_id,
      churn_risk_score: (riskCalculation as any).risk_score,
      risk_level: (riskCalculation as any).risk_level,
      contributing_factors: (riskCalculation as any).contributing_factors,
      recommendations: (riskCalculation as any).recommendations,
      is_new: (result as any).is_new,
      previous_score: (result as any).previous_score,
    });
  }
);

export default calculateChurnRiskWorkflow;
