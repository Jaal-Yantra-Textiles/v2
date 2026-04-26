import { createStep, StepResponse } from "@medusajs/workflows-sdk"
import { ENCRYPTION_MODULE } from "../../../modules/encryption"
import EncryptionService from "../../../modules/encryption/service"

/**
 * Step: Encrypt Platform Tokens
 * 
 * Encrypts OAuth tokens and API keys before storing in database.
 * This ensures all credentials are encrypted at rest.
 */
export const encryptPlatformTokensStep = createStep(
  "encrypt-platform-tokens",
  async (
    input: {
      api_config?: Record<string, unknown> | null
    },
    { container }
  ) => {
    // If no api_config, nothing to encrypt
    if (!input.api_config) {
      return new StepResponse({ encrypted_api_config: null as Record<string, any> | null })
    }

    const encryptionService = container.resolve(ENCRYPTION_MODULE) as EncryptionService
    const apiConfig = input.api_config as Record<string, any>
    const encryptedConfig: Record<string, any> = {}

    // Encrypt access_token if present
    if (apiConfig.access_token && typeof apiConfig.access_token === 'string') {
      encryptedConfig.access_token_encrypted = encryptionService.encrypt(apiConfig.access_token)
      console.log("[Encrypt Tokens] ✓ Access token encrypted")
    }

    // Encrypt refresh_token if present
    if (apiConfig.refresh_token && typeof apiConfig.refresh_token === 'string') {
      encryptedConfig.refresh_token_encrypted = encryptionService.encrypt(apiConfig.refresh_token)
      console.log("[Encrypt Tokens] ✓ Refresh token encrypted")
    }

    // Encrypt OAuth1 credentials if present
    if (apiConfig.oauth1_credentials) {
      const oauth1 = apiConfig.oauth1_credentials as Record<string, any>
      encryptedConfig.oauth1_credentials_encrypted = {
        access_token: oauth1.access_token 
          ? encryptionService.encrypt(oauth1.access_token)
          : undefined,
        access_token_secret: oauth1.access_token_secret
          ? encryptionService.encrypt(oauth1.access_token_secret)
          : undefined,
      }
      console.log("[Encrypt Tokens] ✓ OAuth1 credentials encrypted")
    }

    // Encrypt OAuth1 app credentials if present
    if (apiConfig.oauth1_app_credentials) {
      const oauth1App = apiConfig.oauth1_app_credentials as Record<string, any>
      encryptedConfig.oauth1_app_credentials_encrypted = {
        consumer_key: oauth1App.consumer_key
          ? encryptionService.encrypt(oauth1App.consumer_key)
          : undefined,
        consumer_secret: oauth1App.consumer_secret
          ? encryptionService.encrypt(oauth1App.consumer_secret)
          : undefined,
      }
      console.log("[Encrypt Tokens] ✓ OAuth1 app credentials encrypted")
    }

    // Copy over non-sensitive fields
    const nonSensitiveFields = [
      'token_type',
      'expires_in',
      'expires_at',
      'scope',
      'page_id',
      'ig_user_id',
    ]

    for (const field of nonSensitiveFields) {
      if (apiConfig[field] !== undefined) {
        encryptedConfig[field] = apiConfig[field]
      }
    }

    console.log(`[Encrypt Tokens] ✓ Encrypted ${Object.keys(encryptedConfig).length} fields`)

    return new StepResponse({
      encrypted_api_config: encryptedConfig,
    })
  }
)
