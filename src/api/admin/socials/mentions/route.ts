/**
 * @file Admin API routes for managing social media mentions
 * @description Provides endpoints for retrieving mention suggestions and popular mentions across social platforms
 * @module API/Admin/Socials/Mentions
 */

/**
 * @typedef {Object} Mention
 * @property {string} username - The social media username/handle
 * @property {string} display_name - The display name of the user
 * @property {"facebook"|"instagram"|"twitter"} platform - The social media platform
 * @property {number} usage_count - How many times this mention has been used
 * @property {Date} last_used_at - When this mention was last used
 */

/**
 * @typedef {Object} GetMentionsResponse
 * @property {Mention[]} mentions - Array of mention objects
 */

/**
 * Get mention suggestions or popular mentions
 * @route GET /admin/socials/mentions
 * @group Socials - Operations related to social media mentions
 * @param {string} [q] - Search query for mention suggestions
 * @param {"facebook"|"instagram"|"twitter"} [platform] - Filter by social media platform
 * @param {number} [limit=10] - Maximum number of results to return
 * @returns {GetMentionsResponse} 200 - Array of mention objects
 * @throws {MedusaError} 500 - Internal server error when fetching mentions
 *
 * @example request
 * GET /admin/socials/mentions?q=john&platform=twitter&limit=5
 *
 * @example response 200
 * {
 *   "mentions": [
 *     {
 *       "username": "johndoe",
 *       "display_name": "John Doe",
 *       "platform": "twitter",
 *       "usage_count": 42,
 *       "last_used_at": "2023-05-15T10:30:00Z"
 *     },
 *     {
 *       "username": "john_official",
 *       "display_name": "John Official",
 *       "platform": "twitter",
 *       "usage_count": 18,
 *       "last_used_at": "2023-05-10T08:15:00Z"
 *     }
 *   ]
 * }
 *
 * @example request - Get popular mentions without search query
 * GET /admin/socials/mentions?platform=instagram&limit=3
 *
 * @example response 200
 * {
 *   "mentions": [
 *     {
 *       "username": "fashionista",
 *       "display_name": "Fashion Lovers",
 *       "platform": "instagram",
 *       "usage_count": 125,
 *       "last_used_at": "2023-05-20T14:20:00Z"
 *     },
 *     {
 *       "username": "style_guru",
 *       "display_name": "Style Guru",
 *       "platform": "instagram",
 *       "usage_count": 98,
 *       "last_used_at": "2023-05-18T09:45:00Z"
 *     },
 *     {
 *       "username": "trend_setter",
 *       "display_name": "Trend Setter",
 *       "platform": "instagram",
 *       "usage_count": 87,
 *       "last_used_at": "2023-05-17T11:30:00Z"
 *     }
 *   ]
 * }
 */
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
