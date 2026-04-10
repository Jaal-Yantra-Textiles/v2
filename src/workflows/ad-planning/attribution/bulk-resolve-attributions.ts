/**
 * Bulk Resolve Attributions Workflow
 *
 * Batch process unresolved sessions to link them to ad campaigns.
 * Typically run as a scheduled job.
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

type BulkResolveInput = {
  days_back?: number;
  website_id?: string;
  limit?: number;
};

type BulkResolveOutput = {
  processed: number;
  resolved: number;
  failed: number;
  errors: string[];
};

/**
 * Step 1: Fetch unresolved sessions with UTM data
 */
const fetchUnresolvedSessionsStep = createStep(
  "fetch-unresolved-sessions",
  async (input: BulkResolveInput, { container }) => {
    const adPlanningService: AdPlanningService = container.resolve(AD_PLANNING_MODULE);

    const daysBack = input.days_back || 7;
    const fromDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

    // Try to get sessions from analytics module (optional)
    let sessions: any[] = [];
    try {
      const analyticsService = container.resolve(ANALYTICS_MODULE) as any;
      if (analyticsService && analyticsService.listAnalyticsSessions) {
        // Get sessions with UTM campaign data
        const filters: Record<string, any> = {
          started_at: { $gte: fromDate },
          utm_campaign: { $ne: null },
        };

        if (input.website_id) {
          filters.website_id = input.website_id;
        }

        sessions = await analyticsService.listAnalyticsSessions(filters, {
          take: input.limit || 1000,
          order: { started_at: "DESC" },
        });
      }
    } catch (error) {
      console.warn("[BulkResolve] Could not fetch analytics sessions, continuing with empty set");
    }

    // Get existing attribution session IDs for the candidate sessions only.
    // Previously this fetched ALL CampaignAttribution rows with no
    // pagination; beyond the default take limit, records would be missed
    // from the exclusion set and duplicate attributions would be written
    // (failing the unique index on analytics_session_id).
    //
    // Scoping the IN filter to just the candidate session IDs bounds the
    // query to at most `sessions.length` rows, avoiding the default-limit
    // truncation entirely.
    const existingSessionIds = new Set<string>();
    if (sessions.length > 0) {
      try {
        const candidateIds = sessions.map((s: any) => s.session_id);
        const existingAttributions =
          await adPlanningService.listCampaignAttributions(
            { analytics_session_id: candidateIds },
            { take: candidateIds.length }
          );
        for (const a of existingAttributions) {
          existingSessionIds.add(a.analytics_session_id);
        }
      } catch (error) {
        console.warn(
          "[BulkResolve] Could not fetch existing attributions:",
          (error as Error)?.message || error
        );
      }
    }

    // Filter out sessions that already have attribution records
    const unresolvedSessions = sessions.filter(
      (s: any) => !existingSessionIds.has(s.session_id)
    );

    return new StepResponse(unresolvedSessions);
  }
);

/**
 * Step 2: Fetch all ad campaigns for matching
 */
const fetchCampaignsStep = createStep(
  "fetch-campaigns",
  async (_input: void, { container }) => {
    // Build lookup maps
    const campaignMap = new Map<string, any>();
    const nameMap = new Map<string, any>();
    const metaIdMap = new Map<string, any>();

    let campaigns: any[] = [];
    try {
      const socialsService = container.resolve(SOCIALS_MODULE) as any;
      if (socialsService && socialsService.listAdCampaigns) {
        campaigns = await socialsService.listAdCampaigns({});

        for (const campaign of campaigns) {
          campaignMap.set(campaign.id, campaign);
          nameMap.set(campaign.name.toLowerCase().trim(), campaign);
          if (campaign.meta_campaign_id) {
            metaIdMap.set(campaign.meta_campaign_id, campaign);
          }
        }
      }
    } catch (error) {
      console.warn("[BulkResolve] Could not fetch ad campaigns, continuing with empty set");
    }

    return new StepResponse({
      campaigns,
      nameMap: Object.fromEntries(nameMap),
      metaIdMap: Object.fromEntries(metaIdMap),
    });
  }
);

/**
 * Step 3: Batch resolve attributions
 */
const batchResolveStep = createStep(
  "batch-resolve",
  async (
    input: {
      sessions: any[];
      campaignData: {
        campaigns: any[];
        nameMap: Record<string, any>;
        metaIdMap: Record<string, any>;
      };
    },
    { container }
  ) => {
    const adPlanningService: AdPlanningService = container.resolve(AD_PLANNING_MODULE);

    const results = {
      processed: 0,
      resolved: 0,
      failed: 0,
      errors: [] as string[],
    };

    const attributionsToCreate: any[] = [];

    for (const session of input.sessions) {
      results.processed++;

      try {
        const utmCampaign = session.utm_campaign?.toLowerCase().trim();
        if (!utmCampaign) continue;

        // Try to match campaign
        let matchedCampaign: any = null;
        let confidence = 0;
        let method: "exact_utm_match" | "fuzzy_name_match" | "unresolved" = "unresolved";

        // 1. Exact name match
        if (input.campaignData.nameMap[utmCampaign]) {
          matchedCampaign = input.campaignData.nameMap[utmCampaign];
          confidence = 1.0;
          method = "exact_utm_match";
        }
        // 2. Meta campaign ID match (try both raw and normalized)
        else if (input.campaignData.metaIdMap[session.utm_campaign] || input.campaignData.metaIdMap[utmCampaign]) {
          matchedCampaign = input.campaignData.metaIdMap[session.utm_campaign] || input.campaignData.metaIdMap[utmCampaign];
          confidence = 1.0;
          method = "exact_utm_match";
        }
        // 3. Fuzzy match (contains)
        else {
          for (const campaign of input.campaignData.campaigns) {
            const campaignName = campaign.name.toLowerCase();
            if (campaignName.includes(utmCampaign) || utmCampaign.includes(campaignName)) {
              matchedCampaign = campaign;
              confidence = 0.7;
              method = "fuzzy_name_match";
              break;
            }
          }
        }

        // Determine platform
        let platform: "meta" | "google" | "generic" = "generic";
        if (session.utm_source) {
          const source = session.utm_source.toLowerCase();
          if (source.includes("facebook") || source.includes("instagram") || source.includes("meta")) {
            platform = "meta";
          } else if (source.includes("google")) {
            platform = "google";
          }
        }

        // Create attribution record
        attributionsToCreate.push({
          analytics_session_id: session.session_id,
          visitor_id: session.visitor_id,
          website_id: session.website_id,
          ad_campaign_id: matchedCampaign?.id || null,
          platform,
          utm_source: session.utm_source,
          utm_medium: session.utm_medium,
          utm_campaign: session.utm_campaign,
          utm_term: session.utm_term,
          utm_content: session.utm_content,
          is_resolved: matchedCampaign !== null,
          resolution_confidence: confidence,
          resolution_method: method,
          entry_page: session.entry_page,
          session_pageviews: session.pageviews || 1,
          attributed_at: new Date(),
          session_started_at: session.started_at,
        });

        if (matchedCampaign) {
          results.resolved++;
        }
      } catch (error: any) {
        results.failed++;
        results.errors.push(`Session ${session.session_id}: ${error.message}`);
      }
    }

    // Dedup by analytics_session_id before inserting
    const seen = new Set<string>();
    const dedupedAttributions = attributionsToCreate.filter((a: any) => {
      if (seen.has(a.analytics_session_id)) return false;
      seen.add(a.analytics_session_id);
      return true;
    });

    // Batch create attributions with per-record fallback on failure
    if (dedupedAttributions.length > 0) {
      try {
        await adPlanningService.createCampaignAttributions(dedupedAttributions);
      } catch (error: any) {
        // Batch failed — try individual inserts
        for (const attribution of dedupedAttributions) {
          try {
            await adPlanningService.createCampaignAttributions([attribution]);
          } catch (individualError: any) {
            results.failed++;
            results.errors.push(`Session ${attribution.analytics_session_id}: ${individualError.message}`);
          }
        }
      }
    }

    return new StepResponse(results);
  }
);

/**
 * Main workflow: Bulk resolve attributions
 */
export const bulkResolveAttributionsWorkflow = createWorkflow(
  "bulk-resolve-attributions",
  (input: BulkResolveInput) => {
    const sessions = fetchUnresolvedSessionsStep(input);
    const campaignData = fetchCampaignsStep();

    const results = batchResolveStep({
      sessions,
      campaignData,
    });

    return new WorkflowResponse(results);
  }
);

export default bulkResolveAttributionsWorkflow;
