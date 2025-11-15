import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { SOCIAL_PROVIDER_MODULE, SocialProviderService } from "../../../../modules/social-provider"
import { EXTERNAL_STORES_MODULE, ExternalStoresService } from "../../../../modules/external_stores"
import { initiateOauthWorkflow } from "../../../../workflows/socials/initiate-oauth"

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
  const redirectUri = process.env[redirectEnvKey] ?? ""
  // IMPORTANT: Do not default to Twitter scopes. Let provider choose defaults.
  const scope = process.env[scopeEnvKey] ?? ""

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
