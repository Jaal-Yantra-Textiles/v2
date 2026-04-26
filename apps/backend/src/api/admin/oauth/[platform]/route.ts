/**
 * @file Admin OAuth API routes
 * @description Provides endpoints for initiating OAuth flows with social platforms and external stores
 * @module API/Admin/OAuth
 */

/**
 * @typedef {Object} OAuthResponse
 * @property {string} location - The provider authorization URL to redirect users to
 * @property {string} [state] - CSRF protection state token (optional)
 */

/**
 * @typedef {Object} AppOnlyTokenResponse
 * @property {string} token - The OAuth 2.0 bearer token for app-only authentication
 * @property {string} expiresAt - ISO 8601 timestamp when the token expires
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { SOCIAL_PROVIDER_MODULE, SocialProviderService } from "../../../../modules/social-provider"
import { EXTERNAL_STORES_MODULE, ExternalStoresService } from "../../../../modules/external_stores"
import { initiateOauthWorkflow } from "../../../../workflows/socials/initiate-oauth"
import { SOCIALS_MODULE } from "../../../../modules/socials"

/**
 * GET /admin/oauth/:platform
 *
 * Returns a JSON object `{ location: string, state?: string }` for user flows,
 * where `location` is the provider authorization URL that the frontend should
 * redirect the user to in order to start the OAuth flow.
 *
 * Supports:
 * - Social platforms: Instagram, Facebook, LinkedIn, Twitter, Bluesky
 * - External stores: Etsy, Shopify, Amazon
 */
export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const platform = req.params.platform as string | undefined

  if (!platform) {
    res.status(400).json({ message: "Missing platform parameter" })
    return
  }

  const platformLower = platform.toLowerCase()
  
  // Check if this is an external store platform
  const externalStorePlatforms = ["etsy", "shopify", "amazon"]
  if (externalStorePlatforms.includes(platformLower)) {
    // Handle external store OAuth
    const externalStores = req.scope.resolve(EXTERNAL_STORES_MODULE) as ExternalStoresService
    
    if (!externalStores.hasProvider(platformLower)) {
      res.status(400).json({ message: `External store provider "${platform}" not supported` })
      return
    }
    
    const provider = externalStores.getProvider(platformLower)
    
    // Get redirect URI and scope from environment
    const envPlatform = platformLower
    const redirectEnvKey = `${envPlatform.toUpperCase()}_REDIRECT_URI`
    const scopeEnvKey = `${envPlatform.toUpperCase()}_SCOPE`
    const redirectUri = process.env[redirectEnvKey] ?? ""
    const scope = process.env[scopeEnvKey] ?? ""
    
    // Generate state for CSRF protection
    const state = Math.random().toString(36).substring(2, 15)
    
    try {
      const authUrl = await provider.getAuthorizationUrl(redirectUri, scope, state)
      
      res.status(200).json({
        location: authUrl,
        state,
      })
    } catch (error: any) {
      console.error(`[OAuth] Failed to get auth URL for ${platform}:`, error.message)
      res.status(500).json({ message: error.message })
    }
    
    return
  }

  // Handle social platform OAuth (existing logic)
  const flow = (req.query.flow as string | undefined) ?? "oauth-user"

  // Resolve provider service via social_provider module
  const socialProvider = req.scope.resolve(
    SOCIAL_PROVIDER_MODULE
  ) as SocialProviderService
  const provider = socialProvider.getProvider(platformLower)
  if (flow === "app-only") {
    if (typeof provider.getAppBearerToken !== "function") {
      res
        .status(400)
        .json({ message: `Provider ${platform} does not support app-only flow` })
      return
    }
    try {
      const token = await provider.getAppBearerToken()
      console.log(`[App-Only OAuth] Got token for ${platform}:`, { token: token.token.substring(0, 20) + '...', expiresAt: token.expiresAt })
      
      // For app-only flow, we need to store the credentials in the platform
      // This is especially important for Twitter which needs both OAuth 2.0 and OAuth 1.0a
      const platformId = req.query.platform_id as string
      console.log(`[App-Only OAuth] Platform ID: ${platformId}, Platform: ${platformLower}`)
      
      if (platformId && (platformLower === "twitter" || platformLower === "x")) {
        const socialsService = req.scope.resolve(SOCIALS_MODULE) as any
        
        // Get existing platform to preserve OAuth 2.0 user token
        const [existingPlatform] = await socialsService.listSocialPlatforms({
          id: platformId
        })
        
        // Store app-level credentials for Twitter
        const apiKey = process.env.X_API_KEY || process.env.TWITTER_API_KEY
        const apiSecret = process.env.X_API_SECRET || process.env.TWITTER_API_SECRET
        
        console.log(`[App-Only OAuth] Storing credentials for platform ${platformId}`)
        console.log(`[App-Only OAuth] Has API Key: ${!!apiKey}, Has API Secret: ${!!apiSecret}`)
        console.log(`[App-Only OAuth] Existing OAuth 2.0 token: ${!!existingPlatform?.api_config?.access_token}`)
        
        const updated = await socialsService.updateSocialPlatforms({
          selector: { id: platformId },
          data: {
            api_config: {
              // Preserve existing OAuth 2.0 user token if it exists
              ...(existingPlatform?.api_config || {}),
              // OAuth 2.0 app-only bearer token (for read operations)
              app_bearer_token: token.token,
              app_token_expires_at: new Date(token.expiresAt),
              app_token_retrieved_at: new Date(),
              // OAuth 1.0a app credentials (for media upload and posting)
              // These are used to sign requests, not as bearer tokens
              oauth1_app_credentials: {
                consumer_key: apiKey,      // Twitter calls it "API Key" but it's the OAuth 1.0a consumer key
                consumer_secret: apiSecret, // Twitter calls it "API Secret" but it's the OAuth 1.0a consumer secret
              },
            },
          },
        })
        
        console.log(`[App-Only OAuth] ✓ Credentials stored successfully for platform ${platformId}`)
        console.log(`[App-Only OAuth] Updated platforms:`, updated?.length || 0)
      } else {
        console.log(`[App-Only OAuth] Skipping storage - platformId: ${platformId}, platform: ${platformLower}`)
      }
      
      res.status(200).json(token)
    } catch (e) {
      res.status(500).json({ message: (e as Error).message })
    }
    return
  }

  // Normalize "x" to "twitter" for environment variable lookups
  const envPlatform = platform.toLowerCase() === "x" ? "twitter" : platform
  const redirectEnvKey = `${envPlatform.toUpperCase()}_REDIRECT_URI`
  const scopeEnvKey = `${envPlatform.toUpperCase()}_SCOPE`
  
  // Check both X_ and TWITTER_ prefixes for X/Twitter platform
  const redirectUri = platform.toLowerCase() === "x" 
    ? (process.env.X_REDIRECT_URI || process.env.TWITTER_REDIRECT_URI || "")
    : (process.env[redirectEnvKey] ?? "")
  const scope = platform.toLowerCase() === "x"
    ? (process.env.X_SCOPE || process.env.TWITTER_SCOPE || "")
    : (process.env[scopeEnvKey] ?? "")
  
  console.log(`[OAuth Initiate] Platform: ${platform}`)
  console.log(`[OAuth Initiate] Env Platform: ${envPlatform}`)
  console.log(`[OAuth Initiate] Redirect Env Key: ${redirectEnvKey}`)
  console.log(`[OAuth Initiate] Redirect URI: ${redirectUri}`)
  console.log(`[OAuth Initiate] Scope: ${scope}`)

  const { result, errors } = await initiateOauthWorkflow(req.scope).run({
    input: {
      platform,
      redirectUri,
      scope,
    },
  })

  if (errors?.length > 0) {
    // TODO: Better error logging
    console.warn("Workflow reported errors:", errors)
    res.status(500).json({ message: "Workflow execution failed." })
    return
  }

  // Align with UI hook expectations (useInitiateSocialPlatformOAuth): { location, state }
  res.status(200).json({
    location: result.authUrl,
    state: result.state,
  })
}
