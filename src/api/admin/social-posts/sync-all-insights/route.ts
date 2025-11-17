import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SOCIALS_MODULE } from "../../../../modules/socials"
import SocialsService from "../../../../modules/socials/service"
import { PostInsightsService } from "../../../../modules/socials/services/post-insights-service"

/**
 * POST /admin/social-posts/sync-all-insights
 * 
 * Bulk sync insights for all published posts
 * Query params:
 * - platform_id: optional, sync only posts from specific platform
 * - limit: optional, limit number of posts to sync (default: 50)
 */
export const POST = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  const socials = req.scope.resolve(SOCIALS_MODULE) as SocialsService
  const insightsService = new PostInsightsService()

  const platformId = req.query.platform_id as string | undefined
  const limit = parseInt(req.query.limit as string) || 50

  try {
    // Get all published posts
    const filters: any = {
      status: "posted",
    }

    if (platformId) {
      filters.platform_id = platformId
    }

    const posts = await socials.listSocialPosts(filters, {
      take: limit,
      order: { posted_at: "DESC" },
    })

    if (posts.length === 0) {
      return res.json({
        message: "No published posts found",
        success: 0,
        failed: 0,
        results: [],
      })
    }

    console.log(`[Bulk Insights Sync] Found ${posts.length} posts to sync`)

    // Group posts by platform for efficient syncing
    const postsByPlatform: Record<string, any[]> = {}

    for (const post of posts) {
      const platformId = (post as any).platform_id
      if (!postsByPlatform[platformId]) {
        postsByPlatform[platformId] = []
      }
      postsByPlatform[platformId].push(post)
    }

    // Sync insights for each platform
    const allResults: Array<{ postId: string; status: string; error?: string }> = []
    let totalSuccess = 0
    let totalFailed = 0

    for (const [platformId, platformPosts] of Object.entries(postsByPlatform)) {
      try {
        // Get platform and access token
        const [platform] = await socials.listSocialPlatforms({ id: platformId })
        
        if (!platform) {
          console.warn(`Platform ${platformId} not found, skipping posts`)
          platformPosts.forEach(post => {
            allResults.push({
              postId: (post as any).id,
              status: "failed",
              error: "Platform not found",
            })
            totalFailed++
          })
          continue
        }

        const accessToken = (platform as any)?.api_config?.access_token
        
        if (!accessToken) {
          console.warn(`Platform ${platformId} has no access token, skipping posts`)
          platformPosts.forEach(post => {
            allResults.push({
              postId: (post as any).id,
              status: "failed",
              error: "No access token",
            })
            totalFailed++
          })
          continue
        }

        // Determine platform type
        const platformName = (platform as any).name?.toLowerCase() || "facebook"
        let platformType: "facebook" | "instagram" | "twitter" | "linkedin" = "facebook"
        
        if (platformName.includes("instagram")) {
          platformType = "instagram"
        } else if (platformName.includes("twitter") || platformName.includes("x")) {
          platformType = "twitter"
        } else if (platformName.includes("linkedin")) {
          platformType = "linkedin"
        }

        // Prepare posts for bulk sync
        const postsToSync = platformPosts
          .map(post => {
            const insights = (post as any).insights as Record<string, any> || {}
            let platformPostId = 
              insights.instagram_media_id || 
              insights.facebook_post_id ||
              insights.twitter_tweet_id ||
              insights.linkedin_post_id
            
            // Check publish_results array format
            if (!platformPostId && Array.isArray(insights.publish_results)) {
              for (const result of insights.publish_results) {
                if (result.response?.id) {
                  platformPostId = result.response.id
                  break
                }
              }
            }
            
            // Also check object format for publish_results
            if (!platformPostId && insights.publish_results && !Array.isArray(insights.publish_results)) {
              platformPostId = 
                insights.publish_results.instagram?.postId ||
                insights.publish_results.facebook?.postId
            }

            if (!platformPostId) {
              return null
            }

            return {
              id: (post as any).id,
              platform_post_id: platformPostId,
              platform: platformType,
            }
          })
          .filter(Boolean) as Array<{
            id: string
            platform_post_id: string
            platform: "facebook" | "instagram" | "twitter" | "linkedin"
          }>

        // Bulk sync
        const { success, failed, results } = await insightsService.bulkSyncInsights(
          postsToSync,
          accessToken,
          socials
        )

        totalSuccess += success
        totalFailed += failed
        allResults.push(...results)

        console.log(`[Bulk Insights Sync] Platform ${platformId}: ${success} success, ${failed} failed`)
      } catch (error) {
        console.error(`[Bulk Insights Sync] Error syncing platform ${platformId}:`, error)
        platformPosts.forEach(post => {
          allResults.push({
            postId: (post as any).id,
            status: "failed",
            error: error.message,
          })
          totalFailed++
        })
      }
    }

    res.json({
      message: `Synced insights for ${totalSuccess} posts`,
      success: totalSuccess,
      failed: totalFailed,
      total: posts.length,
      results: allResults,
    })
  } catch (error) {
    console.error("Error in bulk insights sync:", error)
    res.status(500).json({ 
      error: "Failed to sync insights",
      details: error.message 
    })
  }
}
