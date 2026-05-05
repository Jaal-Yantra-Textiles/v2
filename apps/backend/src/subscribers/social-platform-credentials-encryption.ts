import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { MedusaContainer } from "@medusajs/framework/types"
import { SOCIALS_MODULE } from "../modules/socials"
import { ENCRYPTION_MODULE } from "../modules/encryption"
import SocialsService from "../modules/socials/service"
import EncryptionService from "../modules/encryption/service"

/**
 * Encrypts credential fields in a SocialPlatform's `api_config` in place,
 * re-reading the row from the DB and writing back only if a change is needed.
 *
 * Idempotent: guarded by `*_encrypted` keys, so repeated invocations are safe
 * (that's why both the subscriber and the update route can call this).
 */
export async function encryptSocialPlatformCredentials(
  id: string,
  container: MedusaContainer,
): Promise<{ encrypted: boolean }> {
  if (!id) return { encrypted: false }

  const socials = container.resolve(SOCIALS_MODULE) as unknown as SocialsService
  const encryptionService = container.resolve(ENCRYPTION_MODULE) as unknown as EncryptionService
  const logger = container.resolve("logger") as any

  try {
    const [platform] = await socials.listSocialPlatforms({ id }, {})

    if (!platform || !platform.api_config) {
      return { encrypted: false }
    }

    const apiConfig = platform.api_config as Record<string, any>
    let needsUpdate = false
    const encryptedConfig: Record<string, any> = { ...apiConfig }

    const encryptBearer = (field: string) => {
      const value = apiConfig[field]
      const encryptedKey = `${field}_encrypted`
      if (typeof value === "string" && value && !apiConfig[encryptedKey]) {
        encryptedConfig[encryptedKey] = encryptionService.encrypt(value)
        // MikroORM merges JSON columns on update, so `delete` on the local
        // object never reaches the DB. Null-out the key instead — the merge
        // wipes the plaintext from storage.
        encryptedConfig[field] = null
        needsUpdate = true
        logger.info(`[Encryption] ✓ Encrypted ${field} for platform ${platform.name}`)
      }
    }

    // Single-token credentials: any non-OAuth platform (Qwen / OpenAI / Meta
    // page tokens / etc.) gets the same treatment.
    encryptBearer("access_token")
    encryptBearer("api_key")
    encryptBearer("refresh_token")
    encryptBearer("page_access_token")
    encryptBearer("user_access_token")
    // Google Business Manager: per-row OAuth client secret and Ads developer token
    encryptBearer("client_secret")
    encryptBearer("developer_token")

    // OAuth1 user credentials
    if (
      apiConfig.oauth1_credentials &&
      typeof apiConfig.oauth1_credentials === "object" &&
      !apiConfig.oauth1_credentials_encrypted
    ) {
      const oauth1 = apiConfig.oauth1_credentials as Record<string, any>
      encryptedConfig.oauth1_credentials_encrypted = {
        access_token: oauth1.access_token ? encryptionService.encrypt(oauth1.access_token) : undefined,
        access_token_secret: oauth1.access_token_secret
          ? encryptionService.encrypt(oauth1.access_token_secret)
          : undefined,
      }
      encryptedConfig.oauth1_credentials = null
      needsUpdate = true
      logger.info(`[Encryption] ✓ Encrypted OAuth1 credentials for platform ${platform.name}`)
    }

    // OAuth1 app credentials
    if (
      apiConfig.oauth1_app_credentials &&
      typeof apiConfig.oauth1_app_credentials === "object" &&
      !apiConfig.oauth1_app_credentials_encrypted
    ) {
      const oauth1App = apiConfig.oauth1_app_credentials as Record<string, any>
      encryptedConfig.oauth1_app_credentials_encrypted = {
        consumer_key: oauth1App.consumer_key ? encryptionService.encrypt(oauth1App.consumer_key) : undefined,
        consumer_secret: oauth1App.consumer_secret
          ? encryptionService.encrypt(oauth1App.consumer_secret)
          : undefined,
      }
      encryptedConfig.oauth1_app_credentials = null
      needsUpdate = true
      logger.info(`[Encryption] ✓ Encrypted OAuth1 app credentials for platform ${platform.name}`)
    }

    if (needsUpdate) {
      await socials.updateSocialPlatforms([
        {
          selector: { id: platform.id },
          data: { api_config: encryptedConfig },
        },
      ])
      logger.info(`[Encryption] ✅ Platform ${platform.name} credentials encrypted and saved`)
    }

    return { encrypted: needsUpdate }
  } catch (error) {
    logger.error(`[Encryption] ❌ Failed to encrypt credentials for platform ${id}:`, error)
    return { encrypted: false }
  }
}

/**
 * Subscriber: Social Platform Credentials Encryption
 *
 * Fires on create/update events as a safety net so any flow that forgets to
 * invoke `encryptSocialPlatformCredentials` synchronously still ends up with
 * encrypted credentials at rest.
 */
export default async function socialPlatformCredentialsEncryptionHandler({
  event: { data },
  container,
}: SubscriberArgs<{
  id: string
}>) {
  const logger = container.resolve("logger") as any
  logger.info(`[Encryption Subscriber] Handling encryption for platform ${data?.id}`)
  await encryptSocialPlatformCredentials(data?.id, container)
}

export const config: SubscriberConfig = {
  event: [
    "social_platform.created",
    "social_platform.updated",
  ],
}
