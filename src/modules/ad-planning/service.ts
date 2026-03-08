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
   * Evaluate segment criteria against customer data.
   *
   * Supports two formats (backward compatible):
   *   Old: { rules: [...], logic: "AND" | "OR" }
   *   New: { logic: "AND" | "OR" | "NOT", rules?: [...], groups?: [...] }
   *
   * logic: "AND"  → all rules + groups must match
   * logic: "OR"   → any rule or group must match
   * logic: "NOT"  → the combined AND result is negated (exclusion group)
   *
   * Operators:
   *   Comparison:    >=, <=, >, <, ==, !=
   *   String:        contains, not_contains
   *   Array:         in, not_in
   *   Range:         between  (value: [min, max])
   *   Date-relative: within_last_days, older_than_days  (value: number of days)
   */
  evaluateSegmentCriteria(
    criteria: {
      logic: "AND" | "OR" | "NOT";
      rules?: Array<{
        field: string;
        operator: string;
        value: any;
      }>;
      groups?: any[];
    },
    customerData: Record<string, any>
  ): boolean {
    const evaluateRule = (rule: { field: string; operator: string; value: any }): boolean => {
      const fieldValue = customerData[rule.field];

      switch (rule.operator) {
        case ">=":
          return fieldValue !== undefined && fieldValue >= rule.value;
        case "<=":
          return fieldValue !== undefined && fieldValue <= rule.value;
        case ">":
          return fieldValue !== undefined && fieldValue > rule.value;
        case "<":
          return fieldValue !== undefined && fieldValue < rule.value;
        case "==":
          // eslint-disable-next-line eqeqeq
          return fieldValue == rule.value;
        case "!=":
          // eslint-disable-next-line eqeqeq
          return fieldValue != rule.value;
        case "contains":
          return fieldValue !== undefined &&
            String(fieldValue).toLowerCase().includes(String(rule.value).toLowerCase());
        case "not_contains":
          return fieldValue === undefined ||
            !String(fieldValue).toLowerCase().includes(String(rule.value).toLowerCase());
        case "in": {
          if (fieldValue === undefined) return false;
          const arr = Array.isArray(rule.value) ? rule.value : [rule.value];
          return arr.includes(fieldValue);
        }
        case "not_in": {
          if (fieldValue === undefined) return true;
          const arr = Array.isArray(rule.value) ? rule.value : [rule.value];
          return !arr.includes(fieldValue);
        }
        case "between": {
          if (fieldValue === undefined) return false;
          const [min, max] = Array.isArray(rule.value) ? rule.value : [rule.value[0], rule.value[1]];
          return fieldValue >= min && fieldValue <= max;
        }
        case "within_last_days": {
          if (!fieldValue) return false;
          const cutoff = new Date();
          cutoff.setDate(cutoff.getDate() - Number(rule.value));
          return new Date(fieldValue) >= cutoff;
        }
        case "older_than_days": {
          if (!fieldValue) return false;
          const cutoff = new Date();
          cutoff.setDate(cutoff.getDate() - Number(rule.value));
          return new Date(fieldValue) < cutoff;
        }
        default:
          return false;
      }
    };

    const ruleResults = (criteria.rules || []).map(evaluateRule);
    const groupResults = (criteria.groups || []).map((g: any) =>
      this.evaluateSegmentCriteria(g, customerData)
    );
    const all = [...ruleResults, ...groupResults];

    if (all.length === 0) return true; // empty criteria matches everyone

    switch (criteria.logic) {
      case "AND":
        return all.every(Boolean);
      case "OR":
        return all.some(Boolean);
      case "NOT":
        // NOT group: true when the combined AND result is false (exclusion)
        return !all.every(Boolean);
      default:
        return all.every(Boolean);
    }
  }
}

export default AdPlanningService;
