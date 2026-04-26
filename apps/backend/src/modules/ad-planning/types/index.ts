/**
 * Ad Planning Module Types
 */

// Conversion Types
export type ConversionType =
  | "lead_form_submission"
  | "add_to_cart"
  | "begin_checkout"
  | "purchase"
  | "page_engagement"
  | "scroll_depth"
  | "time_on_site"
  | "custom";

export type AttributionModel =
  | "last_click"
  | "first_click"
  | "linear"
  | "time_decay";

export type Platform = "meta" | "google" | "generic" | "direct";

// Conversion Goal Types
export type GoalType =
  | "lead_form"
  | "purchase"
  | "add_to_cart"
  | "page_view"
  | "time_on_page"
  | "scroll_depth"
  | "custom_event";

export interface ConversionGoalConditions {
  event_name?: string;
  pathname_pattern?: string;
  min_time_seconds?: number;
  min_scroll_percent?: number;
  custom_conditions?: Record<string, any>;
}

// Attribution Types
export type ResolutionMethod =
  | "exact_utm_match"
  | "fuzzy_name_match"
  | "manual"
  | "unresolved";

// Experiment Types
export type ExperimentStatus = "draft" | "running" | "paused" | "completed";

export type ExperimentType =
  | "ad_creative"
  | "landing_page"
  | "audience"
  | "budget"
  | "bidding";

export type ExperimentMetric =
  | "conversion_rate"
  | "ctr"
  | "cpc"
  | "roas"
  | "leads"
  | "revenue";

export interface ExperimentVariant {
  id: string;
  name: string;
  weight: number;
  campaign_id?: string;
  ad_set_id?: string;
  landing_page_url?: string;
}

export interface VariantResults {
  conversions: number;
  visitors: number;
  rate: number;
  revenue?: number;
}

export interface ExperimentResults {
  control?: VariantResults;
  treatment?: VariantResults;
  [variantId: string]: VariantResults | string | number | undefined;
  winner?: string;
  statistical_significance?: number;
  improvement?: number;
}

// Segment Types
export type SegmentType = "behavioral" | "demographic" | "rfm" | "custom";

export interface SegmentRule {
  field: string;
  operator: ">=" | "<=" | ">" | "<" | "==" | "!=" | "contains" | "not_contains";
  value: any;
}

export interface SegmentCriteria {
  rules: SegmentRule[];
  logic: "AND" | "OR";
}

// Score Types
export type ScoreType =
  | "nps"
  | "engagement"
  | "clv"
  | "churn_risk"
  | "satisfaction";

export interface ScoreBreakdown {
  [component: string]: number;
}

// Sentiment Types
export type SentimentLabel =
  | "very_negative"
  | "negative"
  | "neutral"
  | "positive"
  | "very_positive"
  | "mixed";

export type SentimentSourceType =
  | "feedback"
  | "form_response"
  | "social_mention"
  | "social_comment"
  | "review";

export interface SentimentEmotions {
  joy?: number;
  anger?: number;
  sadness?: number;
  fear?: number;
  surprise?: number;
  disgust?: number;
}

// Journey Types
export type JourneyEventType =
  | "form_submit"
  | "feedback"
  | "purchase"
  | "page_view"
  | "social_engage"
  | "lead_capture"
  | "email_open"
  | "email_click"
  | "ad_click"
  | "support_ticket"
  | "custom";

export type JourneyChannel =
  | "web"
  | "social"
  | "email"
  | "sms"
  | "phone"
  | "in_person"
  | "ad";

export type JourneyStage =
  | "awareness"
  | "interest"
  | "consideration"
  | "intent"
  | "conversion"
  | "retention"
  | "advocacy";

// Forecast Types
export type ForecastLevel = "account" | "campaign";

export interface ForecastConfidenceIntervals {
  spend?: { low: number; high: number };
  impressions?: { low: number; high: number };
  clicks?: { low: number; high: number };
  conversions?: { low: number; high: number };
  revenue?: { low: number; high: number };
}

// NPS Calculation Result
export interface NPSResult {
  score: number;
  promoters: number;
  passives: number;
  detractors: number;
  total: number;
}

// Engagement Score Input
export interface EngagementActivities {
  purchases?: number;
  feedbacks?: number;
  forms?: number;
  socialEngagements?: number;
  pageviews?: number;
}

// CLV Calculation Input
export interface CLVInput {
  totalRevenue: number;
  totalOrders: number;
  customerAgeMonths: number;
  avgRetentionMonths?: number;
}

// UTM Resolution Result
export interface UTMResolutionResult {
  campaignId: string | null;
  confidence: number;
  method: ResolutionMethod;
}
