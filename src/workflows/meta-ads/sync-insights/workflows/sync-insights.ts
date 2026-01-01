import {
  WorkflowData,
  WorkflowResponse,
  createWorkflow,
  transform,
} from "@medusajs/framework/workflows-sdk"
import {
  validateAndFetchPlatformStep,
  fetchInsightsFromMetaStep,
  saveInsightsToDbStep,
  updateEntityMetricsStep,
} from "../steps"
import { SyncInsightsInput, SyncInsightsResult } from "../types"

export const syncInsightsWorkflowId = "sync-meta-ads-insights"

/**
 * Workflow to sync Meta Ads insights
 * 
 * This workflow:
 * 1. Validates input and fetches platform/ad account data
 * 2. Fetches insights from Meta API
 * 3. Saves insights to database
 * 4. Updates aggregated metrics on campaigns, ad sets, and ads
 * 
 * @example
 * ```ts
 * const { result } = await syncInsightsWorkflow(container).run({
 *   input: {
 *     platform_id: "platform_123",
 *     ad_account_id: "act_123456",
 *     level: "campaign",
 *     date_preset: "last_30d",
 *   }
 * })
 * ```
 */
export const syncInsightsWorkflow = createWorkflow(
  syncInsightsWorkflowId,
  (
    input: WorkflowData<SyncInsightsInput>
  ): WorkflowResponse<SyncInsightsResult & { metrics_updated: { campaigns: number; adsets: number; ads: number } }> => {
    // Step 1: Validate and fetch platform data
    const platformData = validateAndFetchPlatformStep(input)

    // Step 2: Fetch insights from Meta
    const fetchedInsights = fetchInsightsFromMetaStep({
      platform: platformData.platform,
      adAccount: platformData.adAccount,
      level: platformData.level,
      datePreset: platformData.datePreset,
      timeIncrement: platformData.timeIncrement,
      includeBreakdowns: (platformData as any).includeBreakdowns,
    })

    // Step 3: Save insights to database
    const saveResults = saveInsightsToDbStep({
      insights: fetchedInsights.insights,
      adAccount: fetchedInsights.adAccount,
      level: fetchedInsights.level,
      timeIncrement: fetchedInsights.timeIncrement,
    })

    // Step 4: Update entity metrics (campaigns, ad sets, ads)
    const metricsResults = updateEntityMetricsStep({
      platform: platformData.platform,
      adAccount: platformData.adAccount,
    })

    // Combine results
    const result = transform(
      { saveResults, metricsResults },
      (data) => ({
        synced: data.saveResults.synced,
        updated: data.saveResults.updated,
        errors: data.saveResults.errors,
        error_messages: data.saveResults.error_messages,
        metrics_updated: {
          campaigns: data.metricsResults.campaigns_updated,
          adsets: data.metricsResults.adsets_updated,
          ads: data.metricsResults.ads_updated,
        },
      })
    )

    return new WorkflowResponse(result)
  }
)
