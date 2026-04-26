/**
 * @file Admin API route for syncing social platform data
 * @description Provides endpoints for syncing hashtags and mentions from social platforms (Facebook/Instagram)
 * @module API/Admin/Socials
 */

/**
 * @typedef {Object} SyncPlatformDataRequest
 * @property {string} platform_id.required - The ID of the social platform to sync data from
 */

/**
 * @typedef {Object} SyncPlatformDataResponse
 * @property {string} message - Success message indicating completion
 * @property {Object} results - The results of the sync operation
 * @property {string} results.platform_id - The platform ID that was synced
 * @property {number} results.hashtags_synced - Number of hashtags synced
 * @property {number} results.mentions_synced - Number of mentions synced
 * @property {Date} results.synced_at - Timestamp when sync completed
 */

/**
 * @typedef {Object} ErrorResponse
 * @property {string} error - Error message
 * @property {string} [details] - Additional error details
 */

/**
 * Sync hashtags and mentions from a social platform
 * @route POST /admin/socials/sync-platform-data
 * @group Socials - Operations related to social media platforms
 * @param {SyncPlatformDataRequest} request.body.required - Platform sync request data
 * @returns {SyncPlatformDataResponse} 200 - Successfully synced platform data
 * @throws {ErrorResponse} 400 - Missing platform_id or invalid request
 * @throws {ErrorResponse} 404 - Platform not found
 * @throws {ErrorResponse} 500 - Internal server error during sync
 *
 * @example request
 * POST /admin/socials/sync-platform-data
 * {
 *   "platform_id": "fb_123456789"
 * }
 *
 * @example response 200
 * {
 *   "message": "Platform data sync completed",
 *   "results": {
 *     "platform_id": "fb_123456789",
 *     "hashtags_synced": 42,
 *     "mentions_synced": 15,
 *     "synced_at": "2023-11-15T14:30:00Z"
 *   }
 * }
 *
 * @example response 400
 * {
 *   "error": "platform_id is required"
 * }
 *
 * @example response 404
 * {
 *   "error": "Platform not found"
 * }
 *
 * @example response 500
 * {
 *   "error": "Failed to sync platform data",
 *   "details": "Connection timeout to Facebook API"
 * }
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { syncPlatformHashtagsMentionsWorkflow } from "../../../../workflows/socials/sync-platform-hashtags-mentions"
import { SOCIALS_MODULE } from "../../../../modules/socials"
import { decryptAccessToken } from "../../../../modules/socials/utils/token-helpers"
import SocialsService from "../../../../modules/socials/service"

/**
 * POST /admin/socials/sync-platform-data
 * 
 * Sync hashtags and mentions from social platform (Facebook/Instagram)
 * Body:
 * - platform_id: ID of the social platform
 */
export const POST = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  const { platform_id } = req.body as { platform_id: string }

  if (!platform_id) {
    return res.status(400).json({ error: "platform_id is required" })
  }

  try {
    // Get platform to extract access token
    const socials: SocialsService = req.scope.resolve(SOCIALS_MODULE)
    
    const [platform] = await socials.listSocialPlatforms({ id: platform_id })
    
    if (!platform) {
      return res.status(404).json({ error: "Platform not found" })
    }

    const apiConfig = (platform as any)?.api_config
    
    if (!apiConfig) {
      return res.status(400).json({ error: "Platform has no api_config" })
    }

    // Decrypt access token using helper
    let accessToken: string
    try {
      accessToken = decryptAccessToken(apiConfig, req.scope)
    } catch (error) {
      return res.status(400).json({ 
        error: "Failed to decrypt access token",
        details: error.message 
      })
    }

    // Run sync workflow
    const { result } = await syncPlatformHashtagsMentionsWorkflow(req.scope).run({
      input: {
        platform_id,
        access_token: accessToken,
      },
    })

    res.json({
      message: "Platform data sync completed",
      results: result,
    })
  } catch (error) {
    console.error("Error syncing platform data:", error)
    res.status(500).json({ 
      error: "Failed to sync platform data",
      details: error.message 
    })
  }
}
