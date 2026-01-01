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
