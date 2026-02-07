/**
 * @file Admin OAuth Callback API route
 * @description Handles OAuth callback for various platforms in the JYT Commerce platform
 * @module API/Admin/OAuth
 */

/**
 * @typedef {Object} OAuthCallbackRequestBody
 * @property {string} id.required - The platform-specific ID (e.g., shop ID, app ID)
 * @property {string} code.required - The OAuth authorization code from the provider
 * @property {string} [state] - Optional state parameter for CSRF protection
 * @property {string} [redirect_uri] - Optional redirect URI for the OAuth flow
 */

/**
 * @typedef {Object} OAuthCallbackSuccessResponse
 * @property {string} access_token - The access token from the OAuth provider
 * @property {string} refresh_token - The refresh token from the OAuth provider
 * @property {number} expires_in - Token expiration time in seconds
 * @property {string} token_type - The type of token (e.g., "Bearer")
 * @property {Object} [user] - User information from the OAuth provider
 * @property {string} [user.id] - User ID from the provider
 * @property {string} [user.email] - User email from the provider
 * @property {string} [user.name] - User name from the provider
 */

/**
 * @typedef {Object} OAuthCallbackErrorResponse
 * @property {string} message - Error message describing the failure
 */

/**
 * Handle OAuth callback for a specific platform
 * @route POST /admin/oauth/{platform}/callback
 * @group OAuth - Operations related to OAuth authentication
 * @param {string} platform.path.required - The OAuth platform (e.g., "google", "facebook", "shopify")
 * @param {OAuthCallbackRequestBody} request.body.required - OAuth callback data
 * @returns {OAuthCallbackSuccessResponse} 200 - Successfully processed OAuth callback
 * @throws {OAuthCallbackErrorResponse} 400 - Missing required fields (id or code)
 * @throws {OAuthCallbackErrorResponse} 500 - Internal server error during OAuth processing
 *
 * @example request
 * POST /admin/oauth/shopify/callback
 * {
 *   "id": "shop_123456789",
 *   "code": "AUTH_CODE_abc123xyz456",
 *   "state": "random_state_string",
 *   "redirect_uri": "https://myapp.com/auth/callback"
 * }
 *
 * @example response 200
 * {
 *   "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
 *   "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
 *   "expires_in": 3600,
 *   "token_type": "Bearer",
 *   "user": {
 *     "id": "user_987654321",
 *     "email": "user@example.com",
 *     "name": "John Doe"
 *   }
 * }
 *
 * @example response 400
 * {
 *   "message": "Missing id or code in request body"
 * }
 *
 * @example response 500
 * {
 *   "message": "Failed to exchange authorization code for tokens"
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { oauthCallbackWorkflow } from "../../../../../workflows/socials/oauth-callback"

interface CallbackRequestBody {
  id: string
  code: string
  state?: string
  redirect_uri?: string
}

export const POST = async (
  req: MedusaRequest<CallbackRequestBody>,
  res: MedusaResponse
) => {
  const { platform } = req.params as { platform: string }
  const { id, code, state, redirect_uri } = req.body || ({} as CallbackRequestBody)

  if (!id || !code) {
    res.status(400).json({ message: "Missing id or code in request body" })
    return
  }

  try {
    // Execute OAuth callback workflow
    const { result } = await oauthCallbackWorkflow(req.scope).run({
      input: {
        platform_id: id,
        platform,
        code,
        state,
        redirect_uri,
      },
    })

    res.status(200).json(result)
  } catch (error: any) {
    req.scope.resolve("logger").error(`[OAuth Callback] Failed: ${error.message}`, error)
    res.status(500).json({ message: error.message })
  }
}
