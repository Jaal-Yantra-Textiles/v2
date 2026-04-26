/**
 * @file Admin API route for syncing Meta Ads insights
 * @description Provides endpoint for syncing historical insights from Meta for campaigns, ad sets, and ads
 * @module API/Admin/MetaAds/Insights
 */

/**
 * @typedef {Object} SyncInsightsInput
 * @property {string} platform_id - The ID of the platform to sync from (required)
 * @property {string} ad_account_id - The ID of the ad account to sync (required)
 * @property {"campaign" | "adset" | "ad"} [level="campaign"] - The level of insights to sync
 * @property {"last_7d" | "last_14d" | "last_30d" | "last_90d" | "maximum"} [date_preset="last_30d"] - The date range preset for insights
 * @property {"1" | "7" | "monthly" | "all_days"} [time_increment="1"] - The time increment for insights (1=daily, 7=weekly)
 * @property {boolean} [include_breakdowns=false] - Whether to include breakdowns in the insights
 */

/**
 * @typedef {Object} SyncInsightsResult
 * @property {number} synced - Number of insights synced
 * @property {number} updated - Number of metrics updated
 * @property {number} errors - Number of errors encountered
 * @property {string[]} error_messages - List of error messages
 * @property {Object} metrics_updated - Details of updated metrics
 */

/**
 * @typedef {Object} SyncInsightsResponse
 * @property {string} message - Status message
 * @property {SyncInsightsResult} results - Sync results
 */

/**
 * Sync historical insights from Meta for campaigns, ad sets, and ads
 * @route POST /admin/meta-ads/insights/sync
 * @group Meta Ads Insights - Operations related to Meta Ads insights
 * @param {SyncInsightsInput} request.body.required - Sync configuration
 * @returns {SyncInsightsResponse} 200 - Sync results
 * @throws {MedusaError} 400 - Invalid input data or failed to sync
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * POST /admin/meta-ads/insights/sync
 * {
 *   "platform_id": "meta_123456789",
 *   "ad_account_id": "act_987654321",
 *   "level": "campaign",
 *   "date_preset": "last_30d",
 *   "time_increment": "1",
 *   "include_breakdowns": false
 * }
 *
 * @example response 200
 * {
 *   "message": "Insights sync completed",
 *   "results": {
 *     "synced": 15,
 *     "updated": 10,
 *     "errors": 0,
 *     "error_messages": [],
 *     "metrics_updated": {
 *       "campaigns": 5,
 *       "adsets": 3,
 *       "ads": 2
 *     }
 *   }
 * }
 *
 * @example response 200 (with errors)
 * {
 *   "message": "Sync completed with 2 error(s)",
 *   "results": {
 *     "synced": 12,
 *     "updated": 8,
 *     "errors": 2,
 *     "error_messages": [
 *       "Failed to fetch insights for campaign camp_123",
 *       "Invalid date range for adset adset_456"
 *     ],
 *     "metrics_updated": {
 *       "campaigns": 4,
 *       "adsets": 2,
 *       "ads": 2
 *     }
 *   }
 * }
 *
 * @example response 400
 * {
 *   "message": "platform_id is required"
 * }
 *
 * @example response 400 (sync failure)
 * {
 *   "message": "Failed to sync insights",
 *   "results": {
 *     "synced": 0,
 *     "updated": 0,
 *     "errors": 1,
 *     "error_messages": ["Invalid ad account credentials"],
 *     "metrics_updated": {}
 *   }
 * }
 *
 * @example response 500
 * {
 *   "message": "Failed to sync insights",
 *   "error": "Internal server error occurred"
 * }
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { syncInsightsWorkflow } from "../../../../../workflows/meta-ads/sync-insights"

/**
 * POST /admin/meta-ads/insights/sync
 * 
 * Sync historical insights from Meta for campaigns, ad sets, and ads.
 * 
 * This route delegates to the syncInsightsWorkflow which handles:
 * 1. Validating input and fetching platform/ad account data
 * 2. Fetching insights from Meta API
 * 3. Saving insights to database
 * 4. Updating aggregated metrics on campaigns, ad sets, and ads
 * 
 * Body:
 * - platform_id: Platform ID to sync from (required)
 * - ad_account_id: Ad account ID to sync (required)
 * - level: "campaign" | "adset" | "ad" (default: "campaign")
 * - date_preset: "last_7d" | "last_14d" | "last_30d" | "last_90d" | "maximum" (default: "last_30d")
 * - time_increment: "1" (daily) | "7" (weekly) | "monthly" | "all_days" (default: "1")
 */
export const POST = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  try {
    const body = req.body as Record<string, any>
    
    const { 
      platform_id, 
      ad_account_id,
      level = "campaign",
      date_preset = "last_30d",
      time_increment = "1",
      include_breakdowns = false,
    } = body

    // Basic validation (workflow will do more thorough validation)
    if (!platform_id) {
      return res.status(400).json({ message: "platform_id is required" })
    }
    
    if (!ad_account_id) {
      return res.status(400).json({ message: "ad_account_id is required" })
    }

    // Run the workflow
    const { result } = await syncInsightsWorkflow(req.scope).run({
      input: {
        platform_id,
        ad_account_id,
        level: level as "campaign" | "adset" | "ad",
        date_preset: date_preset as "last_7d" | "last_14d" | "last_30d" | "last_90d" | "maximum",
        time_increment,
        include_breakdowns,
      },
    })

    // Return appropriate status based on results
    if (result.errors > 0 && result.synced === 0 && result.updated === 0) {
      return res.status(400).json({
        message: "Failed to sync insights",
        results: result,
      })
    }

    res.json({
      message: result.errors > 0 
        ? `Sync completed with ${result.errors} error(s)` 
        : "Insights sync completed",
      results: {
        synced: result.synced,
        updated: result.updated,
        errors: result.errors,
        error_messages: result.error_messages,
        metrics_updated: result.metrics_updated,
      },
    })
  } catch (error: any) {
    res.status(500).json({
      message: "Failed to sync insights",
      error: error.message,
    })
  }
}
