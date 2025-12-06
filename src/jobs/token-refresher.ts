import { MedusaContainer } from "@medusajs/framework/types"
import SocialsService from "../modules/socials/service"
import { refreshTokenWorkflow } from "../workflows/socials/refresh-token"
import { TwitterOAuth2Token } from "../modules/social-provider/types"
import { SOCIALS_MODULE } from "../modules/socials"

// Define a local type for the SocialPlatform to ensure type safety
type SocialPlatform = {
  id: string
  name: string
  api_config?: {
    // Nested token structure (legacy)
    token?: TwitterOAuth2Token & { retrieved_at?: number | Date }
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
    
    // Check for nested token structure (legacy)
    const nestedToken = apiConfig.token
    if (nestedToken?.retrieved_at && nestedToken?.expires_in) {
      const retrievedAt =
        typeof nestedToken.retrieved_at === "number"
          ? nestedToken.retrieved_at
          : new Date(nestedToken.retrieved_at).getTime()
      const expiryTime = retrievedAt + nestedToken.expires_in * 1000
      if (expiryTime < now + oneHourBuffer) {
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
        return true
      }
    }
    
    return false
  })

  if (platformsToRefresh.length > 0) {
    logger.info(
      `Found ${platformsToRefresh.length} social platform(s) to refresh.`
    )
    for (const platform of platformsToRefresh) {
      logger.info(`- Triggering refresh for ${platform.name} (${platform.id})`)
      await refreshTokenWorkflow(container).run({
        input: {
          platformId: platform.id,
        },
      })
    }
  } else {
    logger.info("No social platform tokens need refreshing at this time.")
  }
}

export const config = {
  name: "token-refresher-hourly",
  schedule: "0 * * * *", // cron expression: runs at the start of every hour
}
