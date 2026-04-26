import { MedusaContainer } from "@medusajs/framework/types"
import SocialsService from "../modules/socials/service"
import { refreshTokenWorkflow } from "../workflows/socials/refresh-token"
import { TwitterOAuth2Token } from "../modules/social-provider/types"
import { SOCIALS_MODULE } from "../modules/socials"

// Platforms that support token refresh
// Facebook does NOT support refresh tokens - it uses long-lived tokens instead
const PLATFORMS_WITH_REFRESH_SUPPORT = ["x", "twitter", "linkedin"]

// Define a local type for the SocialPlatform to ensure type safety
type SocialPlatform = {
  id: string
  name: string
  api_config?: {
    // Nested token structure (legacy)
    token?: TwitterOAuth2Token & { retrieved_at?: number | Date; refresh_token_encrypted?: any }
    // Flat token structure (X/Twitter OAuth 2.0)
    retrieved_at?: string | number | Date
    expires_in?: number
    refresh_token?: string
    refresh_token_encrypted?: any
    provider?: string
    [key: string]: any
  } | null
}

export default async function tokenRefreshJob(container: MedusaContainer) {
  const logger = container.resolve("logger")
  const socialsService: SocialsService = container.resolve(SOCIALS_MODULE)

  // Get all platforms and filter in code.
  // For a larger scale, consider a more optimized query.
  const allPlatforms = (await socialsService.listSocialPlatforms(
      {}
  )) as unknown as SocialPlatform[]
  const now = Date.now()
  // Refresh tokens that will expire in the next hour
  const oneHourBuffer = 60 * 60 * 1000

  const platformsToRefresh = allPlatforms.filter((p) => {
    const apiConfig = p.api_config
    if (!apiConfig) return false
    
    // Check if this platform supports token refresh
    const platformName = p.name.toLowerCase()
    const supportsRefresh = PLATFORMS_WITH_REFRESH_SUPPORT.some(
      supported => platformName.includes(supported)
    )
    
    if (!supportsRefresh) {
      // Skip platforms that don't support refresh (e.g., Facebook, Instagram)
      return false
    }
    
    // Check for nested token structure (legacy)
    const nestedToken = apiConfig.token
    const hasNestedRefreshToken = nestedToken?.refresh_token || nestedToken?.refresh_token_encrypted
    if (nestedToken?.retrieved_at && nestedToken?.expires_in && hasNestedRefreshToken) {
      const retrievedAt =
        typeof nestedToken.retrieved_at === "number"
          ? nestedToken.retrieved_at
          : new Date(nestedToken.retrieved_at).getTime()
      const expiryTime = retrievedAt + nestedToken.expires_in * 1000
      if (expiryTime < now + oneHourBuffer) {
        logger.info(`[Token Refresh] ${p.name}: Token expires at ${new Date(expiryTime).toISOString()}, needs refresh`)
        return true
      }
    }
    
    // Check for flat token structure (X/Twitter OAuth 2.0)
    const hasRefreshToken = apiConfig.refresh_token || apiConfig.refresh_token_encrypted
    if (apiConfig.retrieved_at && apiConfig.expires_in && hasRefreshToken) {
      const retrievedAt =
        typeof apiConfig.retrieved_at === "number"
          ? apiConfig.retrieved_at
          : new Date(apiConfig.retrieved_at as string).getTime()
      const expiryTime = retrievedAt + apiConfig.expires_in * 1000
      if (expiryTime < now + oneHourBuffer) {
        logger.info(`[Token Refresh] ${p.name}: Token expires at ${new Date(expiryTime).toISOString()}, needs refresh`)
        return true
      }
    }
    
    return false
  })

  if (platformsToRefresh.length > 0) {
    logger.info(
      `Found ${platformsToRefresh.length} social platform(s) to refresh.`
    )
    
    let successCount = 0
    let failCount = 0
    
    for (const platform of platformsToRefresh) {
      logger.info(`[Token Refresh] Triggering refresh for ${platform.name} (${platform.id})`)
      try {
        await refreshTokenWorkflow(container).run({
          input: {
            platformId: platform.id,
          },
        })
        successCount++
        logger.info(`[Token Refresh] ✓ Successfully refreshed token for ${platform.name}`)
      } catch (error: any) {
        failCount++
        logger.error(`[Token Refresh] ✗ Failed to refresh token for ${platform.name}: ${error.message}`)
        // Continue with other platforms even if one fails
      }
    }
    
    logger.info(`[Token Refresh] Completed: ${successCount} succeeded, ${failCount} failed`)
  } else {
    logger.info("[Token Refresh] No social platform tokens need refreshing at this time.")
  }
}

export const config = {
  name: "token-refresher-hourly",
  schedule: "0 * * * *", // cron expression: runs at the start of every hour
}
