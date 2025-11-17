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
    let platformPostId = 
      insights.instagram_media_id || 
      insights.facebook_post_id ||
      insights.twitter_tweet_id ||
      insights.linkedin_post_id ||
      // Check nested structures
      insights.instagram_insights?.media_id ||
      insights.facebook_insights?.post_id
    
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
