import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SOCIALS_MODULE } from "../../../../modules/socials"
import SocialsService from "../../../../modules/socials/service"
import { HashtagSearchService } from "../../../../modules/socials/services/hashtag-search-service"
import FacebookService from "../../../../modules/social-provider/facebook-service"

/**
 * GET /admin/socials/hashtags
 * 
 * Smart hashtag search with Instagram API + DB caching
 * 
 * Query params:
 * - q: search query
 * - platform: facebook | instagram | twitter | all
 * - platform_id: optional, for Instagram API access
 * - limit: number of results (default 10)
 * - type: suggestions | popular | recent
 */
export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  const socials = req.scope.resolve(SOCIALS_MODULE) as SocialsService
  const searchService = new HashtagSearchService()
  
  const query = req.query.q as string || ""
  const platform = req.query.platform as "facebook" | "instagram" | "twitter" | "all" || "all"
  const platformId = req.query.platform_id as string | undefined
  const limit = parseInt(req.query.limit as string) || 10
  const type = req.query.type as "suggestions" | "popular" | "recent" || "suggestions"

  console.log("Hashtag API called:", { query, platform, platformId, limit, type })

  let hashtags

  try {
    if (type === "popular") {
      hashtags = await socials.getPopularHashtags(platform, limit)
    } else if (type === "recent") {
      hashtags = await socials.getRecentHashtags(platform, limit)
    } else {
      // Smart search with Instagram API + caching
      let igUserId: string | null = null
      let accessToken: string | null = null

      // Get Instagram credentials if platform_id provided
      if (platformId && platform === "instagram") {
        try {
          const [platformData] = await socials.listSocialPlatforms({ id: platformId })
          if (platformData) {
            accessToken = (platformData as any)?.api_config?.access_token
            
            if (accessToken) {
              // Get Instagram Business Account ID
              const fb = new FacebookService()
              const pages = await fb.listManagedPages(accessToken)
              
              for (const page of pages) {
                const igResponse = await fetch(
                  `https://graph.facebook.com/v21.0/${page.id}?fields=instagram_business_account&access_token=${accessToken}`
                )
                const igData = await igResponse.json()
                if (igData.instagram_business_account?.id) {
                  igUserId = igData.instagram_business_account.id
                  break
                }
              }
            }
          }
        } catch (error) {
          console.log("Could not get Instagram credentials:", error)
        }
      }

      // Get page ID for Facebook if needed
      let pageId: string | null = null
      if (platform === "facebook" && platformId && accessToken) {
        try {
          const fb = new FacebookService()
          const pages = await fb.listManagedPages(accessToken)
          if (pages.length > 0) {
            pageId = pages[0].id
          }
        } catch (error) {
          console.log("Could not get Facebook page ID:", error)
        }
      }

      // Use smart search service
      hashtags = await searchService.searchHashtags(
        query,
        platform,
        {
          igUserId,
          accessToken,
          pageId,
        },
        socials,
        limit
      )
    }

    console.log("Hashtags found:", hashtags.length)

    res.json({
      hashtags: hashtags.map(h => ({
        tag: h.tag,
        platform: h.platform,
        usage_count: h.usage_count,
        last_used_at: h.last_used_at,
      })),
    })
  } catch (error) {
    console.error("Error fetching hashtags:", error)
    res.json({ hashtags: [] })
  }
}
