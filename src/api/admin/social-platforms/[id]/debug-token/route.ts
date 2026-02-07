/**
 * @file Admin API route for debugging social platform tokens
 * @description Provides an endpoint to debug and validate Facebook access tokens for social platforms
 * @module API/Admin/SocialPlatforms
 */

/**
 * @typedef {Object} TokenInfo
 * @property {string} app_id - The Facebook application ID
 * @property {string} type - The token type (USER or PAGE)
 * @property {string} application - The application name
 * @property {number} expires_at - Unix timestamp when token expires
 * @property {boolean} is_valid - Whether the token is valid
 * @property {number} issued_at - Unix timestamp when token was issued
 * @property {string[]} scopes - Array of granted permissions
 * @property {string} user_id - The Facebook user ID
 * @property {number} data_access_expires_at - Unix timestamp when data access expires
 */

/**
 * @typedef {Object} TokenRecommendations
 * @property {boolean} has_pages_read_engagement - Whether token has pages_read_engagement permission
 * @property {boolean} has_pages_manage_posts - Whether token has pages_manage_posts permission
 * @property {boolean} has_pages_show_list - Whether token has pages_show_list permission
 * @property {string} token_type - The token type
 * @property {boolean} needs_reauth - Whether the token needs reauthorization
 */

/**
 * @typedef {Object} DebugTokenResponse
 * @property {Object} platform - The social platform information
 * @property {string} platform.id - The platform ID
 * @property {string} platform.name - The platform name
 * @property {TokenInfo} token_info - Detailed token information
 * @property {Object} entity_info - Facebook entity information (user or page)
 * @property {TokenRecommendations} recommendations - Token permission recommendations
 */

/**
 * Debug Facebook token permissions
 * @route GET /admin/social-platforms/:id/debug-token
 * @group SocialPlatforms - Operations related to social platforms
 * @param {string} id.path.required - The social platform ID
 * @returns {DebugTokenResponse} 200 - Token debug information
 * @throws {MedusaError} 400 - No access token found or failed to debug token
 * @throws {MedusaError} 404 - Platform not found
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * GET /admin/social-platforms/fb_123456789/debug-token
 *
 * @example response 200
 * {
 *   "platform": {
 *     "id": "fb_123456789",
 *     "name": "Facebook Page"
 *   },
 *   "token_info": {
 *     "app_id": "123456789012345",
 *     "type": "PAGE",
 *     "application": "My Commerce App",
 *     "expires_at": 1735689600,
 *     "is_valid": true,
 *     "issued_at": 1704067200,
 *     "scopes": ["pages_read_engagement", "pages_manage_posts", "pages_show_list"],
 *     "user_id": "987654321",
 *     "data_access_expires_at": 1735689600
 *   },
 *   "entity_info": {
 *     "id": "123456789012345",
 *     "name": "My Business Page"
 *   },
 *   "recommendations": {
 *     "has_pages_read_engagement": true,
 *     "has_pages_manage_posts": true,
 *     "has_pages_show_list": true,
 *     "token_type": "PAGE",
 *     "needs_reauth": false
 *   }
 * }
 *
 * @example response 400
 * {
 *   "error": "No access token found for platform"
 * }
 *
 * @example response 404
 * {
 *   "error": "Platform not found"
 * }
 *
 * @example response 500
 * {
 *   "error": "Failed to debug token",
 *   "message": "Internal server error"
 * }
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * Debug Facebook token permissions
 * GET /admin/social-platforms/:id/debug-token
 */
export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  const { id } = req.params

  try {
    const socials = req.scope.resolve("socialsModuleService") as any
    
    // Get platform
    const [platform] = await socials.listSocialPlatforms({ id })
    
    if (!platform) {
      return res.status(404).json({ error: "Platform not found" })
    }

    const config = platform.config as Record<string, any>
    const accessToken = config.access_token || config.page_access_token

    if (!accessToken) {
      return res.status(400).json({ error: "No access token found for platform" })
    }

    // Debug token using Facebook's debug_token endpoint
    const debugUrl = `https://graph.facebook.com/v21.0/debug_token?input_token=${accessToken}&access_token=${accessToken}`
    
    const debugResponse = await fetch(debugUrl)
    const debugData = await debugResponse.json()

    if (debugData.error) {
      return res.status(400).json({ 
        error: "Failed to debug token",
        details: debugData.error 
      })
    }

    // Get token info
    const tokenInfo = debugData.data || {}
    
    // Also try to get the user/page info
    let entityInfo = null
    try {
      const meResponse = await fetch(`https://graph.facebook.com/v21.0/me?access_token=${accessToken}`)
      entityInfo = await meResponse.json()
    } catch (error) {
      console.warn("Could not fetch entity info:", error)
    }

    return res.json({
      platform: {
        id: platform.id,
        name: platform.name,
      },
      token_info: {
        app_id: tokenInfo.app_id,
        type: tokenInfo.type, // "USER" or "PAGE"
        application: tokenInfo.application,
        expires_at: tokenInfo.expires_at,
        is_valid: tokenInfo.is_valid,
        issued_at: tokenInfo.issued_at,
        scopes: tokenInfo.scopes || [],
        user_id: tokenInfo.user_id,
        data_access_expires_at: tokenInfo.data_access_expires_at,
      },
      entity_info: entityInfo,
      recommendations: {
        has_pages_read_engagement: tokenInfo.scopes?.includes("pages_read_engagement"),
        has_pages_manage_posts: tokenInfo.scopes?.includes("pages_manage_posts"),
        has_pages_show_list: tokenInfo.scopes?.includes("pages_show_list"),
        token_type: tokenInfo.type,
        needs_reauth: !tokenInfo.is_valid || !tokenInfo.scopes?.includes("pages_manage_posts"),
      }
    })

  } catch (error) {
    console.error("[Debug Token] Error:", error)
    return res.status(500).json({ 
      error: "Failed to debug token",
      message: error.message 
    })
  }
}
