/**
 * @file Admin API route for syncing social post insights
 * @description Provides an endpoint to fetch and sync insights (likes, comments, shares, etc.) for a published social media post
 * @module API/Admin/SocialPosts
 */

/**
 * @typedef {Object} SyncInsightsResponse
 * @property {string} message - Success message
 * @property {Object} insights - The synced insights data
 * @property {number} [insights.likes] - Number of likes
 * @property {number} [insights.comments] - Number of comments
 * @property {number} [insights.shares] - Number of shares
 * @property {number} [insights.impressions] - Number of impressions
 * @property {number} [insights.reach] - Reach count
 * @property {Date} [insights.last_synced_at] - When insights were last synced
 */

/**
 * @typedef {Object} ErrorResponse
 * @property {string} error - Error message
 * @property {string} [details] - Additional error details
 * @property {Object} [debug] - Debugging information
 * @property {string[]} [debug.available_keys] - Available insight keys
 * @property {string} [debug.post_status] - Current post status
 * @property {string} [debug.post_url] - Post URL
 * @property {string} [debug.hint] - Helpful hint for resolution
 */

/**
 * Sync insights for a published social media post
 * @route POST /admin/social-posts/:id/sync-insights
 * @group SocialPosts - Operations related to social media posts
 * @param {string} id.path.required - The ID of the social post to sync insights for
 * @returns {SyncInsightsResponse} 200 - Successfully synced insights
 * @throws {ErrorResponse} 400 - Post must be published before syncing insights or no platform post ID found
 * @throws {ErrorResponse} 404 - Post not found or platform not found
 * @throws {ErrorResponse} 500 - Failed to sync insights due to server error
 *
 * @example request
 * POST /admin/social-posts/socpst_123456789/sync-insights
 *
 * @example response 200
 * {
 *   "message": "Insights synced successfully",
 *   "insights": {
 *     "likes": 150,
 *     "comments": 25,
 *     "shares": 12,
 *     "impressions": 5000,
 *     "reach": 3800,
 *     "last_synced_at": "2023-11-15T14:30:00Z"
 *   }
 * }
 *
 * @example response 400
 * {
 *   "error": "Post must be published before syncing insights"
 * }
 *
 * @example response 404
 * {
 *   "error": "Post not found"
 * }
 *
 * @example response 500
 * {
 *   "error": "Failed to sync insights",
 *   "details": "API rate limit exceeded"
 * }
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SOCIALS_MODULE } from "../../../../../modules/socials"
import SocialsService from "../../../../../modules/socials/service"
import { PostInsightsService } from "../../../../../modules/socials/services/post-insights-service"

/**
 * POST /admin/social-posts/:id/sync-insights
 * 
 * Sync insights for a single social post
 * Fetches likes, comments, shares, impressions, reach, etc.
 */
export const POST = async (
  req: MedusaRequest<{ id: string }>,
  res: MedusaResponse
) => {
  const { id } = req.params
  const socials = req.scope.resolve(SOCIALS_MODULE) as SocialsService
  const insightsService = new PostInsightsService()

  try {
    // Get post
    const [post] = await socials.listSocialPosts({ id })
    
    if (!post) {
      return res.status(404).json({ error: "Post not found" })
    }

    // Check if post has been published
    if (post.status !== "posted") {
      return res.status(400).json({ 
        error: "Post must be published before syncing insights" 
      })
    }

    // Get platform post ID from insights
    const insights = (post as any).insights as Record<string, any> || {}
    
    // Try multiple possible locations for platform post IDs
    // Track which platform the ID came from for proper API routing
    let platformPostId: string | undefined
    let detectedPlatformType: "facebook" | "instagram" | "twitter" | "linkedin" | undefined
    
    // Check Instagram first (most specific)
    if (insights.instagram_media_id) {
      platformPostId = insights.instagram_media_id
      detectedPlatformType = "instagram"
    } else if (insights.instagram_insights?.media_id) {
      platformPostId = insights.instagram_insights.media_id
      detectedPlatformType = "instagram"
    }
    // Then Facebook
    else if (insights.facebook_post_id) {
      platformPostId = insights.facebook_post_id
      detectedPlatformType = "facebook"
    } else if (insights.facebook_insights?.post_id) {
      platformPostId = insights.facebook_insights.post_id
      detectedPlatformType = "facebook"
    }
    // Then Twitter
    else if (insights.twitter_tweet_id) {
      platformPostId = insights.twitter_tweet_id
      detectedPlatformType = "twitter"
    }
    // Then LinkedIn
    else if (insights.linkedin_post_id) {
      platformPostId = insights.linkedin_post_id
      detectedPlatformType = "linkedin"
    }
    
    // Check publish_results array format
    if (!platformPostId && Array.isArray(insights.publish_results)) {
      // publish_results is an array of results
      for (const result of insights.publish_results) {
        if (result.response?.id) {
          platformPostId = result.response.id
          console.log("[Sync Insights] Found platform post ID in publish_results:", platformPostId)
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

    // If still not found, try to extract from post_url
    if (!platformPostId && post.post_url) {
      const url = post.post_url as string
      
      // Extract Instagram media ID from permalink
      if (url.includes('instagram.com/p/')) {
        const match = url.match(/instagram\.com\/p\/([^\/\?]+)/)
        if (match) {
          platformPostId = match[1]
          console.log("[Sync Insights] Extracted Instagram shortcode from URL:", platformPostId)
        }
      }
      // Extract Facebook post ID from URL
      else if (url.includes('facebook.com')) {
        const match = url.match(/facebook\.com\/(\d+)\/posts\/(\d+)/) || 
                     url.match(/facebook\.com\/permalink\.php\?story_fbid=(\d+)/)
        if (match) {
          platformPostId = match[match.length - 1]
          console.log("[Sync Insights] Extracted Facebook post ID from URL:", platformPostId)
        }
      }
    }

    if (!platformPostId) {
      console.log("[Sync Insights] Available insights keys:", Object.keys(insights))
      console.log("[Sync Insights] Insights structure:", JSON.stringify(insights, null, 2))
      console.log("[Sync Insights] Post URL:", post.post_url)
      
      return res.status(400).json({ 
        error: "No platform post ID found. Post may not have been published successfully.",
        debug: {
          available_keys: Object.keys(insights),
          post_status: post.status,
          post_url: post.post_url,
          hint: "Please re-publish the post to ensure platform IDs are stored correctly."
        }
      })
    }

    // Get platform and access token
    const [platform] = await socials.listSocialPlatforms({ id: (post as any).platform_id })
    
    if (!platform) {
      return res.status(404).json({ error: "Platform not found" })
    }

    const accessToken = (platform as any)?.api_config?.access_token
    
    if (!accessToken) {
      return res.status(400).json({ error: "Platform has no access token" })
    }

    // Determine platform type - prefer detected type from insights, fallback to platform name
    let platformType: "facebook" | "instagram" | "twitter" | "linkedin" = detectedPlatformType || "facebook"
    
    // If no detected type, try to infer from platform name
    if (!detectedPlatformType) {
      const platformName = (platform as any).name?.toLowerCase() || "facebook"
      if (platformName.includes("instagram")) {
        platformType = "instagram"
      } else if (platformName.includes("twitter") || platformName.includes("x")) {
        platformType = "twitter"
      } else if (platformName.includes("linkedin")) {
        platformType = "linkedin"
      }
    }
    
    console.log(`[Sync Insights] Using platform type: ${platformType} (detected: ${detectedPlatformType || 'none'})`)

    // Sync insights
    const syncedInsights = await insightsService.syncPostInsights(
      id,
      platformPostId,
      platformType,
      accessToken,
      socials
    )

    res.json({
      message: "Insights synced successfully",
      insights: syncedInsights,
    })
  } catch (error) {
    console.error("Error syncing insights:", error)
    res.status(500).json({ 
      error: "Failed to sync insights",
      details: error.message 
    })
  }
}
