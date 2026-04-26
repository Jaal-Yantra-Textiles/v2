/**
 * Resolve Session Attribution Workflow
 *
 * Resolves UTM parameters to actual ad campaigns for attribution tracking.
 * Tries exact match first, then fuzzy matching.
 */

import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { AD_PLANNING_MODULE } from "../../../modules/ad-planning";
import type AdPlanningService from "../../../modules/ad-planning/service";
import { SOCIALS_MODULE } from "../../../modules/socials";
import { ANALYTICS_MODULE } from "../../../modules/analytics";

type ResolveSessionAttributionInput = {
  session_id: string;
  website_id?: string;
};

type ResolveSessionAttributionOutput = {
  attribution: any;
  resolved: boolean;
};

/**
 * Step 1: Fetch the analytics session
 */
const fetchSessionStep = createStep(
  "fetch-session",
  async (input: { session_id: string }, { container }) => {
    const analyticsService = container.resolve(ANALYTICS_MODULE) as any;

    const [session] = await analyticsService.listAnalyticsSessions({
      session_id: input.session_id,
    });

    if (!session) {
      throw new Error(`Session ${input.session_id} not found`);
    }

    return new StepResponse(session);
  }
);

// Type for campaign resolution result
type CampaignResolution = {
  campaign_id: string | null;
  confidence: number;
  method: "exact_utm_match" | "fuzzy_name_match" | "manual" | "unresolved";
  platform: "meta" | "google" | "generic";
};

/**
 * Step 2: Resolve campaign from UTM parameters
 */
const resolveCampaignStep = createStep(
  "resolve-campaign",
  async (
    input: {
      utm_source?: string;
      utm_medium?: string;
      utm_campaign?: string;
    },
    { container }
  ): Promise<StepResponse<CampaignResolution, CampaignResolution>> => {
    const socialsService = container.resolve(SOCIALS_MODULE) as any;
    const adPlanningService: AdPlanningService = container.resolve(AD_PLANNING_MODULE);

    // If no UTM campaign, can't resolve
    if (!input.utm_campaign) {
      const unresolved: CampaignResolution = {
        campaign_id: null,
        confidence: 0,
        method: "unresolved",
        platform: "generic",
      };
      return new StepResponse(unresolved);
    }

    // Get all ad campaigns
    const campaigns = await socialsService.listAdCampaigns({});

    // Use the service method to resolve
    const result = await adPlanningService.resolveUtmToCampaign(
      input.utm_campaign,
      campaigns.map((c: any) => ({
        id: c.id,
        name: c.name,
        meta_campaign_id: c.meta_campaign_id,
      }))
    );

    // Determine platform from utm_source
    let platform: "meta" | "google" | "generic" = "generic";
    if (input.utm_source) {
      const source = input.utm_source.toLowerCase();
      if (source.includes("facebook") || source.includes("instagram") || source.includes("meta")) {
        platform = "meta";
      } else if (source.includes("google")) {
        platform = "google";
      }
    }

    const resolved: CampaignResolution = {
      campaign_id: result.campaignId,
      confidence: result.confidence,
      method: result.method as "exact_utm_match" | "fuzzy_name_match" | "manual" | "unresolved",
      platform,
    };
    return new StepResponse(resolved);
  }
);

/**
 * Step 3: Create or update attribution record
 */
const createAttributionStep = createStep(
  "create-attribution",
  async (
    input: {
      session: any;
      resolution: {
        campaign_id: string | null;
        confidence: number;
        method: "exact_utm_match" | "fuzzy_name_match" | "manual" | "unresolved";
        platform: "meta" | "google" | "generic";
      };
    },
    { container }
  ) => {
    const adPlanningService: AdPlanningService = container.resolve(AD_PLANNING_MODULE);

    // Check if attribution already exists
    const existing = await adPlanningService.listCampaignAttributions({
      analytics_session_id: input.session.session_id,
    });

    if (existing.length > 0) {
      // Update existing
      const [attribution] = await adPlanningService.updateCampaignAttributions([
        {
          selector: { id: existing[0].id },
          data: {
            ad_campaign_id: input.resolution.campaign_id,
            is_resolved: input.resolution.campaign_id !== null,
            resolution_confidence: input.resolution.confidence,
            resolution_method: input.resolution.method,
            platform: input.resolution.platform,
          },
        },
      ]);
      return new StepResponse(attribution, existing[0]);
    }

    // Create new attribution
    const [attribution] = await adPlanningService.createCampaignAttributions([
      {
        analytics_session_id: input.session.session_id,
        visitor_id: input.session.visitor_id,
        website_id: input.session.website_id,
        ad_campaign_id: input.resolution.campaign_id,
        platform: input.resolution.platform,
        utm_source: input.session.utm_source,
        utm_medium: input.session.utm_medium,
        utm_campaign: input.session.utm_campaign,
        utm_term: input.session.utm_term,
        utm_content: input.session.utm_content,
        is_resolved: input.resolution.campaign_id !== null,
        resolution_confidence: input.resolution.confidence,
        resolution_method: input.resolution.method,
        entry_page: input.session.entry_page,
        session_pageviews: input.session.pageviews || 1,
        attributed_at: new Date(),
        session_started_at: input.session.started_at,
      },
    ]);

    return new StepResponse(attribution, null);
  },
  // Compensation: delete created attribution
  async (previousData, { container }) => {
    if (previousData === null) {
      // We created a new one, need to delete
      // Note: In real implementation, we'd store the created ID
    }
  }
);

/**
 * Main workflow: Resolve session attribution
 */
export const resolveSessionAttributionWorkflow = createWorkflow(
  "resolve-session-attribution",
  (input: ResolveSessionAttributionInput) => {
    const session = fetchSessionStep({ session_id: input.session_id } as any);

    const resolution = resolveCampaignStep({
      utm_source: (session as any).utm_source,
      utm_medium: (session as any).utm_medium,
      utm_campaign: (session as any).utm_campaign,
    } as any);

    const attribution = createAttributionStep({
      session,
      resolution,
    } as any);

    return new WorkflowResponse({
      attribution,
      resolved: (resolution as any).campaign_id !== null,
    });
  }
);

export default resolveSessionAttributionWorkflow;
