import { MedusaService, MedusaError } from "@medusajs/framework/utils"

import TwitterService from "./twitter-service"
import InstagramService from "./instagram-service"
import FacebookService from "./facebook-service"
import LinkedInService from "./linkedin-service"
import ContentPublishingService from "./content-publishing-service"
import { OAuth2Token } from "./types"


export interface BaseSocialProviderService {
  getAppBearerToken?: () => Promise<{ token: string; expiresAt: number }>
  getAuthUrl?: (redirectUri: string, scope: string) => string
  refreshAccessToken?: (refreshToken: string) => Promise<OAuth2Token>;
  // extend with other common methods when needed
}

// InstagramService uses Facebook tokens, so it doesn't implement OAuth interface
type SocialProvider = BaseSocialProviderService | ContentPublishingService | InstagramService

/**
 * SocialProviderService – runtime delegator to concrete provider SDK wrappers
 * 
 * Note: InstagramService uses Facebook Login for authentication.
 * Use FacebookService for OAuth, then use InstagramService for Instagram operations.
 */
class SocialProviderService extends MedusaService({}) {
  private cache_: Record<string, SocialProvider> = {}

  getProvider<T = BaseSocialProviderService>(name: string): T {
    const key = name.toLowerCase()
    if (!this.cache_[key]) {
      switch (key) {
        case "twitter":
          this.cache_[key] = new TwitterService()
          break
        case "instagram":
          this.cache_[key] = new InstagramService()
          break
        case "facebook":
          this.cache_[key] = new FacebookService()
          break
        case "linkedin":
          this.cache_[key] = new LinkedInService()
          break
        case "content-publishing":
          this.cache_[key] = new ContentPublishingService()
          break
        default:
          throw new Error(`Unsupported provider: ${name}`)
      }
    }
    return this.cache_[key] as unknown as T
  }

  /**
   * Get the unified content publishing service
   */
  getContentPublisher(): ContentPublishingService {
    return this.getProvider<ContentPublishingService>("content-publishing")
  }

  /* Convenience wrappers removed; callers use provider directly */
}

export default SocialProviderService
