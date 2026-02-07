import { MedusaService } from "@medusajs/framework/utils";

// Ad Planning Models
import Conversion from "./models/conversion";
import ConversionGoal from "./models/conversion-goal";
import CampaignAttribution from "./models/campaign-attribution";
import ABExperiment from "./models/ab-experiment";
import BudgetForecast from "./models/budget-forecast";

// Consumer Insights Models
import CustomerSegment from "./models/customer-segment";
import SegmentMember from "./models/segment-member";
import CustomerScore from "./models/customer-score";
import SentimentAnalysis from "./models/sentiment-analysis";
import CustomerJourney from "./models/customer-journey";

class AdPlanningService extends MedusaService({
  // Ad Planning
  Conversion,
  ConversionGoal,
  CampaignAttribution,
  ABExperiment,
  BudgetForecast,
  // Consumer Insights
  CustomerSegment,
  SegmentMember,
  CustomerScore,
  SentimentAnalysis,
  CustomerJourney,
}) {
  constructor() {
    super(...arguments);
  }

  /**
   * Calculate NPS score from feedback ratings
   * Maps 1-5 rating scale to NPS 0-10 scale
   * NPS = % Promoters (9-10) - % Detractors (0-6)
   */
  calculateNPS(ratings: number[]): {
    score: number;
    promoters: number;
    passives: number;
    detractors: number;
    total: number;
  } {
    if (ratings.length === 0) {
      return { score: 0, promoters: 0, passives: 0, detractors: 0, total: 0 };
    }

    // Map 1-5 to 0-10 (1→2, 2→4, 3→6, 4→8, 5→10)
    const npsRatings = ratings.map((r) => r * 2);

    let promoters = 0;
    let passives = 0;
    let detractors = 0;

    for (const rating of npsRatings) {
      if (rating >= 9) {
        promoters++;
      } else if (rating >= 7) {
        passives++;
      } else {
        detractors++;
      }
    }

    const total = ratings.length;
    const score = Math.round(
      ((promoters - detractors) / total) * 100
    );

    return {
      score,
      promoters,
      passives,
      detractors,
      total,
    };
  }

  /**
   * Calculate engagement score from various activities
   * Weights: purchase (10), feedback (5), form (3), social (5), pageview (1)
   */
  calculateEngagementScore(activities: {
    purchases?: number;
    feedbacks?: number;
    forms?: number;
    socialEngagements?: number;
    pageviews?: number;
  }): number {
    const weights = {
      purchases: 10,
      feedbacks: 5,
      forms: 3,
      socialEngagements: 5,
      pageviews: 1,
    };

    const maxScore = 100;
    let rawScore = 0;

    rawScore += (activities.purchases || 0) * weights.purchases;
    rawScore += (activities.feedbacks || 0) * weights.feedbacks;
    rawScore += (activities.forms || 0) * weights.forms;
    rawScore += (activities.socialEngagements || 0) * weights.socialEngagements;
    rawScore += (activities.pageviews || 0) * weights.pageviews;

    // Normalize to 0-100 scale with diminishing returns
    // Using logarithmic scaling: score = 100 * (1 - e^(-rawScore/50))
    const normalizedScore = Math.min(
      maxScore,
      Math.round(maxScore * (1 - Math.exp(-rawScore / 50)))
    );

    return normalizedScore;
  }

  /**
   * Calculate Customer Lifetime Value (CLV)
   * Simple formula: avg_order_value × purchase_frequency × retention_period
   */
  calculateCLV(data: {
    totalRevenue: number;
    totalOrders: number;
    customerAgeMonths: number;
    avgRetentionMonths?: number;
  }): number {
    if (data.totalOrders === 0 || data.customerAgeMonths === 0) {
      return 0;
    }

    const avgOrderValue = data.totalRevenue / data.totalOrders;
    const purchaseFrequencyPerMonth = data.totalOrders / data.customerAgeMonths;
    const retentionPeriod = data.avgRetentionMonths || 24; // Default 2 years

    const clv = avgOrderValue * purchaseFrequencyPerMonth * retentionPeriod;

    return Math.round(clv * 100) / 100; // Round to 2 decimal places
  }

  /**
   * Resolve UTM campaign to AdCampaign ID
   * Tries exact match first, then fuzzy matching
   */
  async resolveUtmToCampaign(
    utmCampaign: string,
    adCampaigns: Array<{ id: string; name: string; meta_campaign_id?: string }>
  ): Promise<{
    campaignId: string | null;
    confidence: number;
    method: "exact_utm_match" | "fuzzy_name_match" | "unresolved";
  }> {
    if (!utmCampaign || adCampaigns.length === 0) {
      return { campaignId: null, confidence: 0, method: "unresolved" };
    }

    const normalizedUtm = utmCampaign.toLowerCase().trim();

    // Try exact match on campaign name
    for (const campaign of adCampaigns) {
      if (campaign.name.toLowerCase().trim() === normalizedUtm) {
        return { campaignId: campaign.id, confidence: 1.0, method: "exact_utm_match" };
      }
    }

    // Try exact match on meta_campaign_id
    for (const campaign of adCampaigns) {
      if (campaign.meta_campaign_id === utmCampaign) {
        return { campaignId: campaign.id, confidence: 1.0, method: "exact_utm_match" };
      }
    }

    // Try fuzzy match (contains)
    for (const campaign of adCampaigns) {
      const campaignName = campaign.name.toLowerCase();
      if (
        campaignName.includes(normalizedUtm) ||
        normalizedUtm.includes(campaignName)
      ) {
        return { campaignId: campaign.id, confidence: 0.7, method: "fuzzy_name_match" };
      }
    }

    return { campaignId: null, confidence: 0, method: "unresolved" };
  }

  /**
   * Evaluate segment criteria against customer data
   */
  evaluateSegmentCriteria(
    criteria: {
      rules: Array<{
        field: string;
        operator: ">=" | "<=" | ">" | "<" | "==" | "!=" | "contains" | "not_contains";
        value: any;
      }>;
      logic: "AND" | "OR";
    },
    customerData: Record<string, any>
  ): boolean {
    const evaluateRule = (rule: typeof criteria.rules[0]): boolean => {
      const fieldValue = customerData[rule.field];

      if (fieldValue === undefined) {
        return false;
      }

      switch (rule.operator) {
        case ">=":
          return fieldValue >= rule.value;
        case "<=":
          return fieldValue <= rule.value;
        case ">":
          return fieldValue > rule.value;
        case "<":
          return fieldValue < rule.value;
        case "==":
          return fieldValue === rule.value;
        case "!=":
          return fieldValue !== rule.value;
        case "contains":
          return String(fieldValue).toLowerCase().includes(String(rule.value).toLowerCase());
        case "not_contains":
          return !String(fieldValue).toLowerCase().includes(String(rule.value).toLowerCase());
        default:
          return false;
      }
    };

    if (criteria.logic === "AND") {
      return criteria.rules.every(evaluateRule);
    } else {
      return criteria.rules.some(evaluateRule);
    }
  }
}

export default AdPlanningService;
