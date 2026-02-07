/**
 * Calculate Customer Lifetime Value Workflow
 *
 * Calculates predicted CLV using historical purchase data.
 */

import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { AD_PLANNING_MODULE } from "../../../modules/ad-planning";
import type AdPlanningService from "../../../modules/ad-planning/service";
import { PERSON_MODULE } from "../../../modules/person";

type CalculateCLVInput = {
  person_id: string;
};

/**
 * Step 1: Gather purchase history
 */
const gatherPurchaseHistoryStep = createStep(
  "gather-purchase-history",
  async (input: { person_id: string }, { container }) => {
    const adPlanningService: AdPlanningService = container.resolve(AD_PLANNING_MODULE);

    // Try to get person info (optional - don't fail if not available)
    let person: any = null;
    try {
      const personService = container.resolve(PERSON_MODULE) as any;
      if (personService && personService.listPersons) {
        const persons = await personService.listPersons({ id: input.person_id });
        person = persons?.[0];
      }
    } catch (error) {
      // Person lookup failed - continue with purchases only
      console.warn("[CLV] Could not fetch person info, continuing with purchase data only");
    }

    // Get all purchases
    const purchases = await adPlanningService.listConversions({
      person_id: input.person_id,
      conversion_type: "purchase",
    });

    // Sort by date
    const sortedPurchases = purchases.sort(
      (a: any, b: any) => new Date(a.converted_at).getTime() - new Date(b.converted_at).getTime()
    );

    // Calculate metrics
    const purchaseCount = sortedPurchases.length;
    const totalRevenue = sortedPurchases.reduce(
      (sum: number, p: any) => sum + (Number(p.conversion_value) || 0),
      0
    );

    const firstPurchase = sortedPurchases[0];
    const lastPurchase = sortedPurchases[sortedPurchases.length - 1];

    // Calculate customer lifespan in days
    const customerCreatedAt = person?.created_at ? new Date(person.created_at) : firstPurchase?.converted_at;
    const lifespanDays = customerCreatedAt
      ? Math.max(1, Math.floor((Date.now() - new Date(customerCreatedAt).getTime()) / (24 * 60 * 60 * 1000)))
      : 1;

    // Calculate purchase frequency (purchases per month)
    const lifespanMonths = Math.max(1, lifespanDays / 30);
    const purchaseFrequency = purchaseCount / lifespanMonths;

    // Calculate average order value
    const averageOrderValue = purchaseCount > 0 ? totalRevenue / purchaseCount : 0;

    // Calculate average days between purchases
    let avgDaysBetweenPurchases = 0;
    if (purchaseCount > 1) {
      const daysBetween: number[] = [];
      for (let i = 1; i < sortedPurchases.length; i++) {
        const days = Math.floor(
          (new Date(sortedPurchases[i].converted_at).getTime() -
            new Date(sortedPurchases[i - 1].converted_at).getTime()) /
            (24 * 60 * 60 * 1000)
        );
        daysBetween.push(days);
      }
      avgDaysBetweenPurchases = daysBetween.reduce((a, b) => a + b, 0) / daysBetween.length;
    }

    return new StepResponse({
      purchase_count: purchaseCount,
      total_revenue: totalRevenue,
      average_order_value: averageOrderValue,
      purchase_frequency: purchaseFrequency,
      avg_days_between_purchases: avgDaysBetweenPurchases,
      lifespan_days: lifespanDays,
      first_purchase_date: firstPurchase?.converted_at || null,
      last_purchase_date: lastPurchase?.converted_at || null,
    });
  }
);

/**
 * Step 2: Calculate predicted CLV
 */
const calculatePredictedCLVStep = createStep(
  "calculate-predicted-clv",
  async (
    input: {
      purchase_count: number;
      total_revenue: number;
      average_order_value: number;
      purchase_frequency: number;
      avg_days_between_purchases: number;
      lifespan_days: number;
    },
    { container }
  ) => {
    // Get existing churn risk for retention probability
    const adPlanningService: AdPlanningService = container.resolve(AD_PLANNING_MODULE);

    // Use a simple BG/NBD-inspired CLV calculation
    // CLV = AOV × Purchase Frequency × Predicted Lifespan

    // Estimate future purchase frequency (with decay)
    const monthlyFrequency = input.purchase_frequency;

    // Estimate average customer lifespan (24 months default, adjusted by activity)
    const baseLifespanMonths = 24;
    let adjustedLifespan = baseLifespanMonths;

    // If customer is active (purchased recently), extend lifespan estimate
    if (input.avg_days_between_purchases > 0 && input.avg_days_between_purchases < 90) {
      adjustedLifespan = Math.min(36, baseLifespanMonths * 1.5);
    } else if (input.avg_days_between_purchases > 180) {
      adjustedLifespan = Math.max(6, baseLifespanMonths * 0.5);
    }

    // Calculate predicted CLV
    const predictedPurchases = monthlyFrequency * adjustedLifespan;
    const predictedCLV = input.average_order_value * predictedPurchases;

    // Calculate remaining CLV (predicted - already realized)
    const remainingCLV = Math.max(0, predictedCLV - input.total_revenue);

    // Determine customer tier based on CLV
    let tier: "platinum" | "gold" | "silver" | "bronze";
    if (predictedCLV >= 50000) {
      tier = "platinum";
    } else if (predictedCLV >= 20000) {
      tier = "gold";
    } else if (predictedCLV >= 5000) {
      tier = "silver";
    } else {
      tier = "bronze";
    }

    // Calculate confidence based on data points
    let confidence: "high" | "medium" | "low";
    if (input.purchase_count >= 5) {
      confidence = "high";
    } else if (input.purchase_count >= 2) {
      confidence = "medium";
    } else {
      confidence = "low";
    }

    return new StepResponse({
      predicted_clv: Math.round(predictedCLV * 100) / 100,
      remaining_clv: Math.round(remainingCLV * 100) / 100,
      realized_clv: input.total_revenue,
      predicted_lifespan_months: adjustedLifespan,
      predicted_purchases: Math.round(predictedPurchases * 10) / 10,
      tier,
      confidence,
      metrics: {
        average_order_value: Math.round(input.average_order_value * 100) / 100,
        monthly_frequency: Math.round(monthlyFrequency * 100) / 100,
        purchase_count: input.purchase_count,
      },
    });
  }
);

/**
 * Step 3: Save CLV score
 */
const saveCLVScoreStep = createStep(
  "save-clv-score",
  async (
    input: {
      person_id: string;
      predicted_clv: number;
      remaining_clv: number;
      realized_clv: number;
      tier: string;
      confidence: string;
      metrics: Record<string, number>;
    },
    { container }
  ) => {
    const adPlanningService: AdPlanningService = container.resolve(AD_PLANNING_MODULE);

    // Check for existing CLV score
    const existing = await adPlanningService.listCustomerScores({
      person_id: input.person_id,
      score_type: "clv",
    });

    const scoreData = {
      predicted_clv: input.predicted_clv,
      remaining_clv: input.remaining_clv,
      realized_clv: input.realized_clv,
      tier: input.tier,
      confidence: input.confidence,
      metrics: input.metrics,
      calculated_at: new Date().toISOString(),
    };

    if (existing.length > 0) {
      // Update existing
      const existingMetadata = existing[0].metadata as Record<string, any> | null;
      const history = existingMetadata?.history || [];
      history.push({
        predicted_clv: input.predicted_clv,
        realized_clv: input.realized_clv,
        date: new Date().toISOString(),
      });

      await adPlanningService.updateCustomerScores({
        id: existing[0].id,
        score_value: input.predicted_clv,
        metadata: {
          ...scoreData,
          history: history.slice(-12), // Keep monthly history for a year
          previous_predicted: existingMetadata?.predicted_clv,
        },
        calculated_at: new Date(),
      });

      return new StepResponse({
        score_id: existing[0].id,
        is_new: false,
      });
    }

    // Create new score
    const [score] = await adPlanningService.createCustomerScores([
      {
        person_id: input.person_id,
        score_type: "clv",
        score_value: input.predicted_clv,
        metadata: {
          ...scoreData,
          history: [
            {
              predicted_clv: input.predicted_clv,
              realized_clv: input.realized_clv,
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
    });
  }
);

/**
 * Main workflow: Calculate CLV
 */
export const calculateCLVWorkflow = createWorkflow(
  "calculate-clv",
  (input: CalculateCLVInput) => {
    const purchaseHistory = gatherPurchaseHistoryStep({ person_id: input.person_id });

    const clvCalculation = calculatePredictedCLVStep({
      purchase_count: purchaseHistory.purchase_count,
      total_revenue: purchaseHistory.total_revenue,
      average_order_value: purchaseHistory.average_order_value,
      purchase_frequency: purchaseHistory.purchase_frequency,
      avg_days_between_purchases: purchaseHistory.avg_days_between_purchases,
      lifespan_days: purchaseHistory.lifespan_days,
    });

    const result = saveCLVScoreStep({
      person_id: input.person_id,
      predicted_clv: clvCalculation.predicted_clv,
      remaining_clv: clvCalculation.remaining_clv,
      realized_clv: clvCalculation.realized_clv,
      tier: clvCalculation.tier,
      confidence: clvCalculation.confidence,
      metrics: clvCalculation.metrics as any,
    } as any);

    return new WorkflowResponse({
      person_id: input.person_id,
      predicted_clv: clvCalculation.predicted_clv,
      remaining_clv: clvCalculation.remaining_clv,
      realized_clv: clvCalculation.realized_clv,
      tier: clvCalculation.tier,
      confidence: clvCalculation.confidence,
      metrics: clvCalculation.metrics,
      is_new: result.is_new,
    });
  }
);

export default calculateCLVWorkflow;
