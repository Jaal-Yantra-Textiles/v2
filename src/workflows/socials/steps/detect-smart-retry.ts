import { createStep, StepResponse } from "@medusajs/workflows-sdk"

/**
 * Step 4: Detect Smart Retry
 * 
 * Analyzes previous publish attempts to determine if this is a retry.
 * Implements smart retry logic: only retry failed platforms.
 * 
 * For FBINSTA platforms:
 * - If Facebook succeeded and Instagram failed → retry Instagram only
 * - If Instagram succeeded and Facebook failed → retry Facebook only
 * - Otherwise → publish to both (or as specified in metadata)
 */
export const detectSmartRetryStep = createStep(
  "detect-smart-retry",
  async (input: { post: any; is_fbinsta: boolean }) => {
    const currentInsights = (input.post.insights as Record<string, unknown>) || {}
    const previousResults = (currentInsights.publish_results as any[]) || []

    const facebookSucceeded = previousResults.some(
      (r: any) => r.platform === "facebook" && r.success
    )
    const instagramSucceeded = previousResults.some(
      (r: any) => r.platform === "instagram" && r.success
    )
    const facebookFailed = previousResults.some(
      (r: any) => r.platform === "facebook" && !r.success
    )
    const instagramFailed = previousResults.some(
      (r: any) => r.platform === "instagram" && !r.success
    )

    const metadata = (input.post.metadata || {}) as Record<string, any>
    
    // For non-FBINSTA platforms, publish_target should be the platform itself
    // "both" only applies to Facebook & Instagram combined platforms
    let publishTarget: string
    if (input.is_fbinsta) {
      publishTarget = (metadata.publish_target as "facebook" | "instagram" | "both") || "both"
    } else {
      // For Twitter/X, LinkedIn, etc. - use the platform name or a sensible default
      publishTarget = metadata.publish_target || "single"
    }

    // Smart retry logic: Only retry failed platforms (only applies to FBINSTA)
    if (input.is_fbinsta && publishTarget === "both") {
      if (facebookSucceeded && instagramFailed) {
        publishTarget = "instagram"
        console.log("🔄 [Smart Retry] Publishing only to Instagram (Facebook already succeeded)")
      } else if (instagramSucceeded && facebookFailed) {
        publishTarget = "facebook"
        console.log("🔄 [Smart Retry] Publishing only to Facebook (Instagram already succeeded)")
      }
    }

    const isRetry = previousResults.length > 0

    console.log(`[Detect Smart Retry] ✓ Target: ${publishTarget}, Is retry: ${isRetry}`)

    return new StepResponse({
      publish_target: publishTarget,
      is_retry: isRetry,
      previous_results: previousResults,
    })
  }
)
