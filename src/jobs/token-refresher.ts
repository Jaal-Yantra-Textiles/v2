import { MedusaContainer } from "@medusajs/framework/types"
import SocialsService from "../modules/socials/service"
import { refreshTokenWorkflow } from "../workflows/socials/refresh-token"
import { TwitterOAuth2Token } from "../modules/social-provider/types"
import { SOCIALS_MODULE } from "../modules/socials"

// Define a local type for the SocialPlatform to ensure type safety
type SocialPlatform = {
  id: string
  provider: string
  api_config?: {
    token?: TwitterOAuth2Token & { retrieved_at?: number | Date }
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
    const token = p.api_config?.token
    if (!token?.retrieved_at || !token?.expires_in) {
      return false
    }
    const retrievedAt =
      typeof token.retrieved_at === "number"
        ? token.retrieved_at
        : new Date(token.retrieved_at).getTime()
    const expiryTime = retrievedAt + token.expires_in * 1000
    return expiryTime < now + oneHourBuffer
  })

  if (platformsToRefresh.length > 0) {
    logger.info(
      `Found ${platformsToRefresh.length} social platform(s) to refresh.`
    )
    for (const platform of platformsToRefresh) {
      logger.info(`- Triggering refresh for ${platform.provider} (${platform.id})`)
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
