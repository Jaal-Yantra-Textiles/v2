import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { SOCIALS_MODULE } from "../modules/socials"
import { ENCRYPTION_MODULE } from "../modules/encryption"
import SocialsService from "../modules/socials/service"
import EncryptionService from "../modules/encryption/service"

/**
 * Subscriber: Social Platform Credentials Encryption
 * 
 * Automatically encrypts OAuth tokens and API credentials when:
 * - A social platform is created
 * - A social platform is updated
 * 
 * This ensures all credentials are encrypted at rest without
 * requiring manual encryption in workflows or API routes.
 */
export default async function socialPlatformCredentialsEncryptionHandler({
  event: { data },
  container,
}: SubscriberArgs<{
  id: string
}>) {
  const socials = container.resolve(SOCIALS_MODULE) as SocialsService
  const encryptionService = container.resolve(ENCRYPTION_MODULE) as EncryptionService
  const logger = container.resolve("logger")

  try {
    logger.info(`[Encryption Subscriber] Handling encryption for platform ${data.id}`)
    // Fetch the platform
    const [platform] = await socials.listSocialPlatforms(
      { id: data.id },
      {}
    )

    if (!platform || !platform.api_config) {
      return // Nothing to encrypt
    }

    const apiConfig = platform.api_config as Record<string, any>
    let needsUpdate = false
    const encryptedConfig: Record<string, any> = { ...apiConfig }

    // Check if access_token needs encryption
    if (apiConfig.access_token && typeof apiConfig.access_token === 'string') {
      // Only encrypt if not already encrypted
      if (!apiConfig.access_token_encrypted) {
        encryptedConfig.access_token_encrypted = encryptionService.encrypt(apiConfig.access_token)
        delete encryptedConfig.access_token // Remove plaintext
        needsUpdate = true
        logger.info(`[Encryption Subscriber] ✓ Encrypted access_token for platform ${platform.name}`)
      }
    }

    // Check if refresh_token needs encryption
    if (apiConfig.refresh_token && typeof apiConfig.refresh_token === 'string') {
      if (!apiConfig.refresh_token_encrypted) {
        encryptedConfig.refresh_token_encrypted = encryptionService.encrypt(apiConfig.refresh_token)
        delete encryptedConfig.refresh_token // Remove plaintext
        needsUpdate = true
        logger.info(`[Encryption Subscriber] ✓ Encrypted refresh_token for platform ${platform.name}`)
      }
    }

    // Check if OAuth1 credentials need encryption
    if (apiConfig.oauth1_credentials && typeof apiConfig.oauth1_credentials === 'object') {
      const oauth1 = apiConfig.oauth1_credentials as Record<string, any>
      
      if (!apiConfig.oauth1_credentials_encrypted) {
        encryptedConfig.oauth1_credentials_encrypted = {
          access_token: oauth1.access_token 
            ? encryptionService.encrypt(oauth1.access_token)
            : undefined,
          access_token_secret: oauth1.access_token_secret
            ? encryptionService.encrypt(oauth1.access_token_secret)
            : undefined,
        }
        delete encryptedConfig.oauth1_credentials // Remove plaintext
        needsUpdate = true
        logger.info(`[Encryption Subscriber] ✓ Encrypted OAuth1 credentials for platform ${platform.name}`)
      }
    }

    // Check if OAuth1 app credentials need encryption
    if (apiConfig.oauth1_app_credentials && typeof apiConfig.oauth1_app_credentials === 'object') {
      const oauth1App = apiConfig.oauth1_app_credentials as Record<string, any>
      
      if (!apiConfig.oauth1_app_credentials_encrypted) {
        encryptedConfig.oauth1_app_credentials_encrypted = {
          consumer_key: oauth1App.consumer_key
            ? encryptionService.encrypt(oauth1App.consumer_key)
            : undefined,
          consumer_secret: oauth1App.consumer_secret
            ? encryptionService.encrypt(oauth1App.consumer_secret)
            : undefined,
        }
        delete encryptedConfig.oauth1_app_credentials // Remove plaintext
        needsUpdate = true
        logger.info(`[Encryption Subscriber] ✓ Encrypted OAuth1 app credentials for platform ${platform.name}`)
      }
    }

    // Update platform if encryption was needed
    if (needsUpdate) {
      await socials.updateSocialPlatforms([
        {
          selector: { id: platform.id },
          data: {
            api_config: encryptedConfig,
          },
        },
      ])
      logger.info(`[Encryption Subscriber] ✅ Platform ${platform.name} credentials encrypted and saved`)
    }
  } catch (error) {
    logger.error(`[Encryption Subscriber] ❌ Failed to encrypt credentials for platform ${data.id}:`, error)
    // Don't throw - we don't want to break platform creation/update if encryption fails
    // The platform will still be created, just with plaintext tokens (which will trigger warnings)
  }
}

export const config: SubscriberConfig = {
  event: [
    "social_platform.created",
    "social_platform.updated",
  ],
}
