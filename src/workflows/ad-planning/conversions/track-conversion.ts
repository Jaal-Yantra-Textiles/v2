/**
 * Track Conversion Workflow
 *
 * Generic workflow for tracking any type of conversion event.
 * Used by event subscribers and client-side tracking.
 */

import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { AD_PLANNING_MODULE } from "../../../modules/ad-planning";
import type AdPlanningService from "../../../modules/ad-planning/service";

type TrackConversionInput = {
  conversion_type:
    | "lead_form_submission"
    | "add_to_cart"
    | "begin_checkout"
    | "purchase"
    | "page_engagement"
    | "scroll_depth"
    | "time_on_site"
    | "custom";
  visitor_id?: string;
  session_id?: string;
  website_id?: string;
  conversion_value?: number;
  currency?: string;
  order_id?: string;
  product_id?: string;
  person_id?: string;
  form_id?: string;
  form_response_id?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  landing_page?: string;
  conversion_page?: string;
  custom_event_name?: string;
  metadata?: Record<string, any>;
};

/**
 * Step 1: Resolve attribution for the session
 */
const resolveAttributionStep = createStep(
  "resolve-attribution",
  async (
    input: {
      session_id?: string;
      utm_campaign?: string;
    },
    { container }
  ) => {
    const adPlanningService: AdPlanningService = container.resolve(AD_PLANNING_MODULE);

    // Check if we have existing attribution for this session
    if (input.session_id) {
      const existing = await adPlanningService.listCampaignAttributions({
        analytics_session_id: input.session_id,
      });

      if (existing.length > 0 && existing[0].is_resolved) {
        return new StepResponse({
          ad_campaign_id: existing[0].ad_campaign_id,
          ad_set_id: existing[0].ad_set_id,
          ad_id: existing[0].ad_id,
          platform: existing[0].platform,
        });
      }
    }

    // No resolved attribution, return nulls
    return new StepResponse({
      ad_campaign_id: null,
      ad_set_id: null,
      ad_id: null,
      platform: "generic" as const,
    });
  }
);

/**
 * Step 2: Create the conversion record
 */
const createConversionStep = createStep(
  "create-conversion",
  async (
    input: {
      conversionData: TrackConversionInput;
      attribution: {
        ad_campaign_id: string | null;
        ad_set_id: string | null;
        ad_id: string | null;
        platform: "meta" | "google" | "generic";
      };
    },
    { container }
  ) => {
    const adPlanningService: AdPlanningService = container.resolve(AD_PLANNING_MODULE);

    const [conversion] = await adPlanningService.createConversions([
      {
        conversion_type: input.conversionData.conversion_type,
        ad_campaign_id: input.attribution.ad_campaign_id,
        ad_set_id: input.attribution.ad_set_id,
        ad_id: input.attribution.ad_id,
        platform: input.attribution.platform,
        visitor_id: input.conversionData.visitor_id || "anonymous",
        analytics_session_id: input.conversionData.session_id,
        session_id: input.conversionData.session_id,
        website_id: input.conversionData.website_id,
        conversion_value: input.conversionData.conversion_value,
        currency: input.conversionData.currency || "INR",
        order_id: input.conversionData.order_id,
        person_id: input.conversionData.person_id,
        utm_source: input.conversionData.utm_source,
        utm_medium: input.conversionData.utm_medium,
        utm_campaign: input.conversionData.utm_campaign,
        utm_term: input.conversionData.utm_term,
        utm_content: input.conversionData.utm_content,
        metadata: {
          ...(input.conversionData.metadata || {}),
          product_id: input.conversionData.product_id,
          form_id: input.conversionData.form_id,
          form_response_id: input.conversionData.form_response_id,
          landing_page: input.conversionData.landing_page,
          conversion_page: input.conversionData.conversion_page,
          custom_event_name: input.conversionData.custom_event_name,
        },
        converted_at: new Date(),
      },
    ]);

    return new StepResponse(conversion, conversion.id);
  },
  // Compensation: delete the conversion
  async (conversionId, { container }) => {
    if (conversionId) {
      const adPlanningService: AdPlanningService = container.resolve(AD_PLANNING_MODULE);
      await adPlanningService.deleteConversions([conversionId]);
    }
  }
);

/**
 * Step 3: Update conversion goals if matched
 */
const updateGoalsStep = createStep(
  "update-goals",
  async (
    input: {
      conversion_type: string;
      website_id?: string;
      conversion_value?: number;
    },
    { container }
  ) => {
    const adPlanningService: AdPlanningService = container.resolve(AD_PLANNING_MODULE);

    // Find matching goals
    const filters: Record<string, any> = {
      goal_type: input.conversion_type,
      is_active: true,
    };

    if (input.website_id) {
      filters.website_id = input.website_id;
    }

    const goals = await adPlanningService.listConversionGoals(filters);

    // Increment conversion counts for each matching goal (tracked in metadata)
    for (const goal of goals) {
      const existingMetadata = (goal.metadata as Record<string, any>) || {};
      const currentCount = (existingMetadata.current_count || 0) + 1;
      const currentValue = (existingMetadata.current_value || 0) + (input.conversion_value || 0);

      await adPlanningService.updateConversionGoals({
        id: goal.id,
        metadata: {
          ...existingMetadata,
          current_count: currentCount,
          current_value: currentValue,
          last_conversion_at: new Date().toISOString(),
        },
      });
    }

    return new StepResponse({ updated_goals: goals.length });
  }
);

/**
 * Step 4: Add to customer journey if person_id exists
 */
const addJourneyEventStep = createStep(
  "add-journey-event",
  async (
    input: {
      person_id?: string;
      conversion_type: string;
      conversion_id: string;
      website_id?: string;
      session_id?: string;
      conversion_value?: number;
    },
    { container }
  ) => {
    if (!input.person_id) {
      return new StepResponse({ added: false });
    }

    const adPlanningService: AdPlanningService = container.resolve(AD_PLANNING_MODULE);

    // Map conversion type to journey stage
    const stageMap: Record<string, string> = {
      page_engagement: "awareness",
      scroll_depth: "interest",
      time_on_site: "interest",
      lead_form_submission: "conversion",
      add_to_cart: "intent",
      begin_checkout: "intent",
      purchase: "conversion",
    };

    const stage = stageMap[input.conversion_type] || "consideration";

    // Map conversion type to journey event type
    const eventTypeMap: Record<string, string> = {
      purchase: "purchase",
      lead_form_submission: "lead_capture",
      page_engagement: "page_view",
      add_to_cart: "custom",
      begin_checkout: "custom",
      scroll_depth: "custom",
      time_on_site: "custom",
      custom: "custom",
    };

    const eventType = eventTypeMap[input.conversion_type] || "custom";

    await adPlanningService.createCustomerJourneys([
      {
        person_id: input.person_id,
        website_id: input.website_id,
        event_type: eventType as "form_submit" | "feedback" | "purchase" | "page_view" | "social_engage" | "lead_capture" | "email_open" | "email_click" | "ad_click" | "support_ticket" | "custom",
        event_name: input.conversion_type,
        stage: stage as "awareness" | "interest" | "consideration" | "intent" | "conversion" | "retention" | "advocacy",
        event_data: {
          conversion_id: input.conversion_id,
          conversion_type: input.conversion_type,
          value: input.conversion_value,
          session_id: input.session_id,
        },
        occurred_at: new Date(),
      },
    ]);

    return new StepResponse({ added: true });
  }
);

/**
 * Main workflow: Track conversion
 */
export const trackConversionWorkflow = createWorkflow(
  "track-conversion",
  (input: TrackConversionInput) => {
    const attribution = resolveAttributionStep({
      session_id: input.session_id,
      utm_campaign: input.utm_campaign,
    });

    const conversion = createConversionStep({
      conversionData: input,
      attribution,
    });

    updateGoalsStep({
      conversion_type: input.conversion_type,
      website_id: input.website_id,
      conversion_value: input.conversion_value,
    });

    addJourneyEventStep({
      person_id: input.person_id,
      conversion_type: input.conversion_type,
      conversion_id: conversion.id,
      website_id: input.website_id,
      session_id: input.session_id,
      conversion_value: input.conversion_value,
    });

    return new WorkflowResponse({
      conversion,
      attributed: attribution.ad_campaign_id !== null,
    });
  }
);

export default trackConversionWorkflow;
