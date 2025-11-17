import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SOCIALS_MODULE } from "../../../../modules/socials"
import SocialsService from "../../../../modules/socials/service"

/**
 * GET /admin/socials/mentions
 * 
 * Get mention suggestions based on query
 * Query params:
 * - q: search query
 * - platform: facebook | instagram | twitter
 * - limit: number of results (default 10)
 */
export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  const socials = req.scope.resolve(SOCIALS_MODULE) as SocialsService
  
  const query = req.query.q as string || ""
  const platform = req.query.platform as "facebook" | "instagram" | "twitter" | undefined
  const limit = parseInt(req.query.limit as string) || 10

  console.log("Mention API called:", { query, platform, limit })

  let mentions

  try {
    if (!query) {
      // If no query, return most used mentions
      const filters: any = {}
      if (platform) {
        filters.platform = platform
      }
      
      mentions = await socials.listMentions(filters, {
        take: limit,
        order: { usage_count: "DESC" },
      })
    } else {
      mentions = await socials.getMentionSuggestions(query, platform, limit)
    }

    console.log("Mentions found:", mentions.length)

    res.json({
      mentions: mentions.map(m => ({
        username: m.username,
        display_name: m.display_name,
        platform: m.platform,
        usage_count: m.usage_count,
        last_used_at: m.last_used_at,
      })),
    })
  } catch (error) {
    console.error("Error fetching mentions:", error)
    res.json({ mentions: [] })
  }
}
