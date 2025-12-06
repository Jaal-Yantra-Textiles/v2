import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { SOCIAL_PROVIDER_MODULE } from "../../../modules/social-provider"
import { EXTERNAL_STORES_MODULE } from "../../../modules/external_stores"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import SocialProviderService from "../../../modules/social-provider/service"
import ExternalStoresService from "../../../modules/external_stores/service"

export type ExchangeOAuthCodeInput = {
  platform: string
  code: string
  state?: string
  redirect_uri?: string
}

export type TokenData = {
  access_token: string
  refresh_token?: string
  token_type?: string
  expires_in?: number
  scope?: string
  retrieved_at?: number | Date
  user_profile?: any
}

export const exchangeOAuthCodeStep = createStep(
  "exchange-oauth-code-step",
  async (input: ExchangeOAuthCodeInput, { container }) => {
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
    const platformLower = input.platform.toLowerCase()
    
    logger.info(`[Exchange OAuth Code] Platform: ${input.platform}`)
    logger.info(`[Exchange OAuth Code] Code received: ${input.code?.substring(0, 10)}...`)

    // Determine redirect URI
    const envPlatform = platformLower === "x" ? "twitter" : platformLower
    const redirectEnvKey = `${envPlatform.toUpperCase()}_REDIRECT_URI`
    
    const redirectUri = input.redirect_uri || (
      platformLower === "x"
        ? (process.env.X_REDIRECT_URI || process.env.TWITTER_REDIRECT_URI || "")
        : (process.env[redirectEnvKey] ?? "")
    )

    logger.info(`[Exchange OAuth Code] Redirect URI: ${redirectUri}`)

    // Check if this is an external store platform
    const externalStorePlatforms = ["etsy", "shopify", "amazon"]
    
    let tokenData: TokenData
    
    if (externalStorePlatforms.includes(platformLower)) {
      // Handle external store OAuth
      const externalStores = container.resolve(EXTERNAL_STORES_MODULE) as ExternalStoresService
      const provider = externalStores.getProvider(platformLower)
      
      // Etsy requires PKCE - get code_verifier from the provider using state
      let codeVerifier: string | undefined
      if (platformLower === "etsy" && input.state) {
        // The Etsy provider stores code verifiers by state
        codeVerifier = (provider as any).getCodeVerifier?.(input.state)
        logger.info(`[Exchange OAuth Code] Etsy PKCE code_verifier retrieved: ${codeVerifier ? 'yes' : 'no'}`)
        
        if (!codeVerifier) {
          throw new Error("Missing code_verifier for Etsy OAuth. The OAuth flow may have expired or the state is invalid.")
        }
      }
      
      tokenData = await provider.exchangeCodeForToken(input.code, redirectUri, codeVerifier)
      
      // Clear the code verifier after successful exchange
      if (platformLower === "etsy" && input.state) {
        (provider as any).clearCodeVerifier?.(input.state)
      }
      
      logger.info(`[Exchange OAuth Code] External store token retrieved for ${platformLower}`)
    } else {
      // Handle social platform OAuth
      const socialProvider = container.resolve(SOCIAL_PROVIDER_MODULE) as SocialProviderService
      const provider = socialProvider.getProvider(platformLower) as any

      // Platform-specific token exchange
      if (platformLower === "twitter" || platformLower === "x") {
        // Twitter/X uses PKCE state to retrieve verifier internally
        tokenData = await provider.exchangeCodeForToken(input.code, redirectUri, input.state)
        
        logger.info(`[Exchange OAuth Code] Twitter token scope: ${tokenData.scope}`)
        
        // Fetch user profile if we have users.read scope
        if (tokenData.scope?.includes('users.read')) {
          try {
            const userProfile = await provider.getUserProfile(tokenData.access_token)
            logger.info(`[Exchange OAuth Code] Twitter user profile fetched: @${userProfile.username}`)
            
            tokenData.user_profile = {
              id: userProfile.id,
              name: userProfile.name,
              username: userProfile.username,
              profile_image_url: userProfile.profile_image_url,
              description: userProfile.description,
              verified: userProfile.verified,
            }
          } catch (error: any) {
            logger.error(`[Exchange OAuth Code] Failed to fetch Twitter user profile: ${error.message}`)
          }
        } else {
          logger.warn(`[Exchange OAuth Code] Skipping user profile fetch - users.read scope not granted`)
        }
      } else {
        // Facebook/LinkedIn/Instagram
        tokenData = await provider.exchangeCodeForToken(input.code, redirectUri)
        logger.info(`[Exchange OAuth Code] Token retrieved for ${platformLower}`)
      }
    }

    // Add retrieved timestamp
    if (!tokenData.retrieved_at) {
      tokenData.retrieved_at = Date.now()
    }

    return new StepResponse(tokenData)
  }
)
