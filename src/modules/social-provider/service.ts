import { MedusaService, MedusaError } from "@medusajs/framework/utils"

import TwitterService from "./twitter-service"
import InstagramService from "./instagram-service"
import FacebookService from "./facebook-service"
import LinkedInService from "./linkedin-service"
import ContentPublishingService from "./content-publishing-service"
import WhatsAppService, { type WhatsAppSender } from "./whatsapp-service"
import { OAuth2Token } from "./types"
import type { MedusaContainer } from "@medusajs/framework/types"
import { SOCIALS_MODULE } from "../socials"
import { ENCRYPTION_MODULE } from "../encryption"
import type EncryptionService from "../encryption/service"
import type { EncryptedData } from "../encryption"
import type { WhatsAppPlatformApiConfig } from "../socials/types/whatsapp-platform"


export interface BaseSocialProviderService {
  getAppBearerToken?: () => Promise<{ token: string; expiresAt: number }>
  getAuthUrl?: (redirectUri: string, scope: string) => string
  refreshAccessToken?: (refreshToken: string) => Promise<OAuth2Token>;
  // extend with other common methods when needed
}

// InstagramService uses Facebook tokens, so it doesn't implement OAuth interface
type SocialProvider = BaseSocialProviderService | ContentPublishingService | InstagramService | WhatsAppService

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
        case "x":
          // Use "twitter" as the canonical cache key for both "twitter" and "x"
          const twitterKey = "twitter"
          if (!this.cache_[twitterKey]) {
            this.cache_[twitterKey] = new TwitterService()
          }
          this.cache_[key] = this.cache_[twitterKey]
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
        case "whatsapp":
          this.cache_[key] = new WhatsAppService()
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

  /**
   * Get the WhatsApp service.
   * Pass the app-level container (req.scope / container) to enable
   * loading credentials from SocialPlatform in the database.
   */
  getWhatsApp(appContainer?: MedusaContainer): WhatsAppService {
    const wa = this.getProvider<WhatsAppService>("whatsapp")
    if (appContainer) wa.setAppContainer(appContainer)
    return wa
  }

  /**
   * Resolve credentials for a specific WhatsApp SocialPlatform row and
   * return a WhatsAppService bound to it. Throws if the platform is not
   * found or isn't a WhatsApp entry.
   */
  async getWhatsAppForPlatform(
    appContainer: MedusaContainer,
    platformId: string
  ): Promise<WhatsAppService> {
    const socials = appContainer.resolve(SOCIALS_MODULE) as any
    const platform = await socials.findWhatsAppPlatformById(platformId)
    if (!platform) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `WhatsApp platform not found: ${platformId}`
      )
    }
    return this.bindWhatsAppSender(appContainer, platform)
  }

  /**
   * Pick a WhatsApp sender based on the recipient's E.164 number (country-
   * code match). Falls back to the default platform when no match is found.
   * Returns null when no WhatsApp platform is configured at all.
   */
  async getWhatsAppForRecipient(
    appContainer: MedusaContainer,
    recipientE164: string
  ): Promise<WhatsAppService | null> {
    const socials = appContainer.resolve(SOCIALS_MODULE) as any
    const platform = await socials.findWhatsAppPlatformForRecipient(recipientE164)
    if (!platform) return null
    return this.bindWhatsAppSender(appContainer, platform)
  }

  /**
   * Look up the WhatsApp platform whose phone_number_id matches the inbound
   * webhook's metadata.phone_number_id. Returns null for unknown numbers.
   */
  async getWhatsAppForInboundPhoneNumberId(
    appContainer: MedusaContainer,
    phoneNumberId: string
  ): Promise<WhatsAppService | null> {
    const socials = appContainer.resolve(SOCIALS_MODULE) as any
    const platform = await socials.findWhatsAppPlatformByPhoneNumberId(phoneNumberId)
    if (!platform) return null
    return this.bindWhatsAppSender(appContainer, platform)
  }

  /**
   * Decrypt creds from a SocialPlatform row and return a sender-bound
   * WhatsAppService. Internal helper — callers use the named entry points.
   */
  private bindWhatsAppSender(
    appContainer: MedusaContainer,
    platform: any
  ): WhatsAppService {
    const cfg = (platform.api_config ?? {}) as WhatsAppPlatformApiConfig
    if (!cfg.phone_number_id) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `WhatsApp platform ${platform.id} missing phone_number_id`
      )
    }

    const encryption = appContainer.resolve(ENCRYPTION_MODULE) as EncryptionService

    const decrypt = (
      encryptedField: EncryptedData | undefined,
      plaintextField: string | undefined
    ): string => {
      if (encryptedField) {
        try {
          return encryption.decrypt(encryptedField)
        } catch {
          return plaintextField ?? ""
        }
      }
      return plaintextField ?? ""
    }

    const accessToken = decrypt(cfg.access_token_encrypted, cfg.access_token)
    const appSecret = decrypt(cfg.app_secret_encrypted, cfg.app_secret)
    const webhookVerifyToken = decrypt(cfg.webhook_verify_token_encrypted, cfg.webhook_verify_token)

    const base = this.getWhatsApp(appContainer)
    return base.withSender({
      platformId: platform.id,
      phoneNumberId: cfg.phone_number_id,
      accessToken,
      appSecret,
      webhookVerifyToken,
    })
  }
}

export default SocialProviderService
