/**
 * Track Lead Conversion Workflow
 *
 * Specialized workflow for lead form submission conversions.
 * Triggered by lead.created or form_response.created events.
 */

import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { AD_PLANNING_MODULE } from "../../../modules/ad-planning";
import type AdPlanningService from "../../../modules/ad-planning/service";

type TrackLeadConversionInput = {
  lead_id?: string;
  form_id?: string;
  form_response_id?: string;
  person_id?: string;
  visitor_id?: string;
  session_id?: string;
  website_id?: string;
  lead_value?: number;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  landing_page?: string;
  conversion_page?: string;
  lead_data?: Record<string, any>;
};

/**
 * Step 1: Find attribution for this lead
 */
const findLeadAttributionStep = createStep(
  "find-lead-attribution",
  async (
    input: {
      session_id?: string;
      visitor_id?: string;
      utm_campaign?: string;
    },
    { container }
  ) => {
    const adPlanningService: AdPlanningService = container.resolve(AD_PLANNING_MODULE);

    // Try session-based attribution
    if (input.session_id) {
      const sessionAttr = await adPlanningService.listCampaignAttributions({
        analytics_session_id: input.session_id,
      });

      if (sessionAttr.length > 0 && sessionAttr[0].is_resolved) {
        return new StepResponse({
          ad_campaign_id: sessionAttr[0].ad_campaign_id,
          ad_set_id: sessionAttr[0].ad_set_id,
          ad_id: sessionAttr[0].ad_id,
          platform: sessionAttr[0].platform,
          utm_source: sessionAttr[0].utm_source,
          utm_medium: sessionAttr[0].utm_medium,
          utm_campaign: sessionAttr[0].utm_campaign,
        });
      }
    }

    // Try visitor-based attribution (first-touch)
    if (input.visitor_id) {
      const visitorAttr = await adPlanningService.listCampaignAttributions({
        visitor_id: input.visitor_id,
        is_resolved: true,
      });

      if (visitorAttr.length > 0) {
        // Get earliest attribution (first touch)
        const sorted = visitorAttr.sort((a: any, b: any) =>
          new Date(a.attributed_at).getTime() - new Date(b.attributed_at).getTime()
        );

        return new StepResponse({
          ad_campaign_id: sorted[0].ad_campaign_id,
          ad_set_id: sorted[0].ad_set_id,
          ad_id: sorted[0].ad_id,
          platform: sorted[0].platform,
          utm_source: sorted[0].utm_source,
          utm_medium: sorted[0].utm_medium,
          utm_campaign: sorted[0].utm_campaign,
        });
      }
    }

    // Determine platform from UTM source if no attribution found
    let platform: "meta" | "google" | "generic" = "generic";
    if (input.utm_campaign) {
      const utmLower = input.utm_campaign.toLowerCase();
      if (utmLower.includes("facebook") || utmLower.includes("instagram") || utmLower.includes("meta")) {
        platform = "meta";
      } else if (utmLower.includes("google") || utmLower.includes("gclid")) {
        platform = "google";
      }
    }

    return new StepResponse({
      ad_campaign_id: null,
      ad_set_id: null,
      ad_id: null,
      platform,
      utm_source: null,
      utm_medium: null,
      utm_campaign: input.utm_campaign ?? null,
    });
  }
);

/**
 * Step 2: Calculate lead value based on form type
 */
const calculateLeadValueStep = createStep(
  "calculate-lead-value",
  async (
    input: {
      form_id?: string;
      website_id?: string;
      provided_value?: number;
    },
    { container }
  ) => {
    // If value is provided, use it
    if (input.provided_value && input.provided_value > 0) {
      return new StepResponse({ value: input.provided_value });
    }

    const adPlanningService: AdPlanningService = container.resolve(AD_PLANNING_MODULE);

    // Check if there's a conversion goal for this form/website
    const filters: Record<string, any> = {
      goal_type: "lead_form",
      is_active: true,
    };

    if (input.website_id) {
      filters.website_id = input.website_id;
    }

    const goals = await adPlanningService.listConversionGoals(filters);

    if (goals.length > 0 && goals[0].default_value) {
      return new StepResponse({ value: Number(goals[0].default_value) });
    }

    // Default lead value
    return new StepResponse({ value: 0 });
  }
);

/**
 * Step 3: Create lead conversion record
 */
const createLeadConversionStep = createStep(
  "create-lead-conversion",
  async (
    input: {
      leadData: TrackLeadConversionInput;
      attribution: {
        ad_campaign_id: string | null;
        ad_set_id: string | null;
        ad_id: string | null;
        platform: "meta" | "google" | "generic";
        utm_source?: string | null;
        utm_medium?: string | null;
        utm_campaign?: string | null;
      };
      lead_value: number;
    },
    { container }
  ) => {
    const adPlanningService: AdPlanningService = container.resolve(AD_PLANNING_MODULE);

    const [conversion] = await adPlanningService.createConversions([
      {
        conversion_type: "lead_form_submission",
        ad_campaign_id: input.attribution.ad_campaign_id,
        ad_set_id: input.attribution.ad_set_id,
        ad_id: input.attribution.ad_id,
        platform: input.attribution.platform,
        visitor_id: input.leadData.visitor_id || "anonymous",
        analytics_session_id: input.leadData.session_id,
        website_id: input.leadData.website_id,
        conversion_value: input.lead_value,
        currency: "INR",
        person_id: input.leadData.person_id,
        lead_id: input.leadData.lead_id,
        utm_source: input.leadData.utm_source || input.attribution.utm_source,
        utm_medium: input.leadData.utm_medium || input.attribution.utm_medium,
        utm_campaign: input.leadData.utm_campaign || input.attribution.utm_campaign,
        utm_term: input.leadData.utm_term,
        utm_content: input.leadData.utm_content,
        metadata: {
          form_id: input.leadData.form_id,
          form_response_id: input.leadData.form_response_id,
          landing_page: input.leadData.landing_page,
          conversion_page: input.leadData.conversion_page,
          lead_data: input.leadData.lead_data,
        },
        converted_at: new Date(),
      },
    ]);

    return new StepResponse(conversion, conversion.id);
  },
  async (conversionId, { container }) => {
    if (conversionId) {
      const adPlanningService: AdPlanningService = container.resolve(AD_PLANNING_MODULE);
      await adPlanningService.deleteConversions([conversionId]);
    }
  }
);

/**
 * Step 4: Update conversion goals metadata with tracking info
 * Since ConversionGoal doesn't have current_count/current_value fields,
 * we track conversion counts in the metadata field
 */
const updateLeadGoalsStep = createStep(
  "update-lead-goals",
  async (
    input: {
      website_id?: string;
      form_id?: string;
      lead_value: number;
    },
    { container }
  ) => {
    const adPlanningService: AdPlanningService = container.resolve(AD_PLANNING_MODULE);

    const filters: Record<string, any> = {
      goal_type: "lead_form",
      is_active: true,
    };

    if (input.website_id) {
      filters.website_id = input.website_id;
    }

    const goals = await adPlanningService.listConversionGoals(filters);

    for (const goal of goals) {
      const currentMetadata = (goal.metadata as Record<string, any>) || {};
      const updatedMetadata = {
        ...currentMetadata,
        tracking: {
          current_count: ((currentMetadata.tracking?.current_count as number) || 0) + 1,
          current_value: ((currentMetadata.tracking?.current_value as number) || 0) + input.lead_value,
          last_conversion_at: new Date().toISOString(),
        },
      };

      await adPlanningService.updateConversionGoals({
        id: goal.id,
        metadata: updatedMetadata,
      });
    }

    return new StepResponse({ updated_goals: goals.length });
  }
);

/**
 * Step 5: Add to customer journey
 */
const addLeadJourneyStep = createStep(
  "add-lead-journey",
  async (
    input: {
      person_id?: string;
      lead_id?: string;
      form_id?: string;
      website_id?: string;
      session_id?: string;
    },
    { container }
  ) => {
    if (!input.person_id) {
      return new StepResponse({ added: false });
    }

    const adPlanningService: AdPlanningService = container.resolve(AD_PLANNING_MODULE);

    await adPlanningService.createCustomerJourneys([
      {
        person_id: input.person_id,
        website_id: input.website_id,
        event_type: "lead_capture",
        stage: "conversion",
        event_data: {
          lead_id: input.lead_id,
          form_id: input.form_id,
          analytics_session_id: input.session_id,
        },
        occurred_at: new Date(),
      },
    ]);

    return new StepResponse({ added: true });
  }
);

/**
 * Main workflow: Track lead conversion
 */
export const trackLeadConversionWorkflow = createWorkflow(
  "track-lead-conversion",
  (input: TrackLeadConversionInput) => {
    const attribution = findLeadAttributionStep({
      session_id: input.session_id,
      visitor_id: input.visitor_id,
      utm_campaign: input.utm_campaign,
    });

    const leadValue = calculateLeadValueStep({
      form_id: input.form_id,
      website_id: input.website_id,
      provided_value: input.lead_value,
    });

    const conversion = createLeadConversionStep({
      leadData: input,
      attribution,
      lead_value: leadValue.value,
    });

    updateLeadGoalsStep({
      website_id: input.website_id,
      form_id: input.form_id,
      lead_value: leadValue.value,
    });

    addLeadJourneyStep({
      person_id: input.person_id,
      lead_id: input.lead_id,
      form_id: input.form_id,
      website_id: input.website_id,
      session_id: input.session_id,
    });

    return new WorkflowResponse({
      conversion,
      attributed: attribution.ad_campaign_id !== null,
      lead_value: leadValue.value,
    });
  }
);

export default trackLeadConversionWorkflow;
