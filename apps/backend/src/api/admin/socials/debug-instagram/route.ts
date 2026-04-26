/**
 * @file Admin API route for debugging Instagram account linking
 * @description Provides an endpoint to test and debug Instagram account connections through the Facebook Graph API
 * @module API/Admin/Socials
 */

/**
 * @typedef {Object} InstagramDebugRequest
 * @property {string} platform_id.required - The ID of the social platform to debug
 */

/**
 * @typedef {Object} InstagramDebugResponse
 * @property {boolean} success - Indicates if the debug operation was successful
 * @property {Object} platform - Information about the social platform
 * @property {string} platform.id - The platform ID
 * @property {string} platform.name - The platform name
 * @property {Object} raw_api_response - Raw response from Facebook Graph API
 * @property {Array} parsed_ig_accounts - Parsed Instagram accounts from the service
 * @property {string|null} service_error - Any error from the Instagram service
 * @property {Object} diagnostics - Diagnostic information about the connection
 * @property {boolean} diagnostics.has_access_token - Whether an access token exists
 * @property {number} diagnostics.token_length - Length of the access token
 * @property {number} diagnostics.pages_count - Number of Facebook pages returned
 * @property {number} diagnostics.pages_with_ig - Number of pages with linked Instagram accounts
 * @property {Object} instructions - Troubleshooting instructions
 * @property {string} instructions.no_ig_accounts - Message when no Instagram accounts are found
 * @property {Array<string>} instructions.steps - Steps to resolve common issues
 */

/**
 * Debug Instagram account linking
 * @route GET /admin/socials/debug-instagram
 * @group Socials - Operations related to social media integrations
 * @param {string} platform_id.query.required - The ID of the social platform to debug
 * @returns {InstagramDebugResponse} 200 - Debug information about the Instagram connection
 * @throws {MedusaError} 400 - Missing platform_id or no access token found
 * @throws {MedusaError} 404 - Platform not found
 * @throws {MedusaError} 500 - Facebook API error or internal server error
 *
 * @example request
 * GET /admin/socials/debug-instagram?platform_id=ig_platform_123
 *
 * @example response 200
 * {
 *   "success": true,
 *   "platform": {
 *     "id": "ig_platform_123",
 *     "name": "Main Instagram Account"
 *   },
 *   "raw_api_response": {
 *     "data": [
 *       {
 *         "id": "123456789",
 *         "name": "My Business Page",
 *         "instagram_business_account": {
 *           "id": "987654321",
 *           "username": "mybusiness"
 *         }
 *       }
 *     ]
 *   },
 *   "parsed_ig_accounts": [
 *     {
 *       "id": "987654321",
 *       "username": "mybusiness",
 *       "page_id": "123456789",
 *       "page_name": "My Business Page"
 *     }
 *   ],
 *   "service_error": null,
 *   "diagnostics": {
 *     "has_access_token": true,
 *     "token_length": 123,
 *     "pages_count": 1,
 *     "pages_with_ig": 1
 *   },
 *   "instructions": {
 *     "no_ig_accounts": "If no Instagram accounts found, ensure:",
 *     "steps": [
 *       "1. Your Instagram account is a Business or Creator account",
 *       "2. The Instagram account is linked to your Facebook Page (Settings → Instagram → Connect Account)",
 *       "3. Your Facebook app has 'instagram_basic' and 'instagram_content_publish' permissions",
 *       "4. You've granted these permissions during OAuth"
 *     ]
 *   }
 * }
 *
 * @example response 400
 * {
 *   "error": "Missing platform_id query parameter"
 * }
 *
 * @example response 404
 * {
 *   "error": "Platform ig_platform_123 not found"
 * }
 *
 * @example response 500
 * {
 *   "error": "Facebook API error",
 *   "status": 403,
 *   "response": {
 *     "error": {
 *       "message": "Invalid OAuth access token",
 *       "type": "OAuthException",
 *       "code": 190
 *     }
 *   },
 *   "hint": "Check if your access token has the required permissions: instagram_basic, instagram_content_publish"
 * }
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SOCIALS_MODULE } from "../../../../modules/socials"
import SocialsService from "../../../../modules/socials/service"
import InstagramService from "../../../../modules/social-provider/instagram-service"

/**
 * GET /admin/socials/debug-instagram?platform_id=xxx
 * 
 * Debug endpoint to check Instagram account linking
 */
export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  const platformId = req.query.platform_id as string | undefined

  if (!platformId) {
    return res.status(400).json({ 
      error: "Missing platform_id query parameter" 
    })
  }

  try {
    const socials = req.scope.resolve(SOCIALS_MODULE) as SocialsService

    // Load the platform
    const [platform] = await socials.listSocialPlatforms({ id: platformId })

    if (!platform) {
      return res.status(404).json({ 
        error: `Platform ${platformId} not found` 
      })
    }

    const apiConfig = (platform.api_config || {}) as Record<string, any>
    const accessToken = apiConfig.access_token as string | undefined

    if (!accessToken) {
      return res.status(400).json({ 
        error: "No access token found in platform configuration" 
      })
    }

    // Test the Instagram API call
    const ig = new InstagramService()
    
    // First, let's check what the raw API returns
    const url = new URL("https://graph.facebook.com/v24.0/me/accounts")
    url.searchParams.set("fields", "id,name,instagram_business_account{id,username}")
    url.searchParams.set("access_token", accessToken)
    
    const resp = await fetch(url.toString())
    const rawData = await resp.json()

    if (!resp.ok) {
      return res.status(500).json({
        error: "Facebook API error",
        status: resp.status,
        response: rawData,
        hint: "Check if your access token has the required permissions: instagram_basic, instagram_content_publish"
      })
    }

    // Now try the service method
    let igAccounts: any[] = []
    let serviceError: string | null = null
    
    try {
      igAccounts = await ig.getLinkedIgAccounts(accessToken)
    } catch (e) {
      serviceError = (e as Error).message
    }

    return res.status(200).json({
      success: true,
      platform: {
        id: platform.id,
        name: (platform as any).name,
      },
      raw_api_response: rawData,
      parsed_ig_accounts: igAccounts,
      service_error: serviceError,
      diagnostics: {
        has_access_token: !!accessToken,
        token_length: accessToken.length,
        pages_count: rawData.data?.length || 0,
        pages_with_ig: rawData.data?.filter((p: any) => p.instagram_business_account).length || 0,
      },
      instructions: {
        no_ig_accounts: "If no Instagram accounts found, ensure:",
        steps: [
          "1. Your Instagram account is a Business or Creator account",
          "2. The Instagram account is linked to your Facebook Page (Settings → Instagram → Connect Account)",
          "3. Your Facebook app has 'instagram_basic' and 'instagram_content_publish' permissions",
          "4. You've granted these permissions during OAuth",
        ]
      }
    })
  } catch (error) {
    return res.status(500).json({
      error: "Debug endpoint failed",
      message: (error as Error).message,
      stack: (error as Error).stack,
    })
  }
}
