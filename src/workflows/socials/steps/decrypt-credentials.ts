import { createStep, StepResponse } from "@medusajs/workflows-sdk"
import { MedusaError } from "@medusajs/utils"
import { decryptAccessToken } from "../../../modules/socials/utils/token-helpers"

/**
 * Step 3: Decrypt Credentials
 * 
 * Decrypts platform credentials using the token helper.
 * Supports both encrypted and plaintext tokens for backward compatibility.
 * Validates Twitter-specific OAuth1 credentials if needed.
 */
export const decryptCredentialsStep = createStep(
  "decrypt-credentials",
  async (input: { platform: any; platform_name: string }, { container }) => {
    const logger = container.resolve("logger")
    const apiConfig = input.platform.api_config as Record<string, unknown>

    // Decrypt access token using helper (supports both encrypted and plaintext)
    let userAccessToken: string
    try {
      userAccessToken = decryptAccessToken(apiConfig, container)
      logger.info(`[Decrypt Credentials] ✓ Access token decrypted successfully`)
    } catch (error) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Failed to decrypt access token: ${error.message}`
      )
    }

    // Handle Twitter OAuth1 credentials
    const credentials: any = { user_access_token: userAccessToken }

    if (input.platform_name === "twitter" || input.platform_name === "x") {
      const oauth1UserCreds = apiConfig.oauth1_credentials as Record<string, any> | undefined
      const oauth1AppCreds = (apiConfig.oauth1_app_credentials || apiConfig.app_credentials) as Record<string, any> | undefined

      // Validate Twitter credentials
      const hasUserOAuth1 = oauth1UserCreds?.access_token && oauth1UserCreds?.access_token_secret
      const hasAppOAuth1 = (oauth1AppCreds?.consumer_key || oauth1AppCreds?.api_key) &&
                           (oauth1AppCreds?.consumer_secret || oauth1AppCreds?.api_secret)

      if (!hasUserOAuth1 && !hasAppOAuth1) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "Twitter requires authentication. Please complete OAuth flow or enable app-only access."
        )
      }

      credentials.oauth1_user = oauth1UserCreds
      credentials.oauth1_app = oauth1AppCreds
      logger.info(`[Decrypt Credentials] ✓ Twitter OAuth1 credentials validated`)
    }

    return new StepResponse({ user_access_token: userAccessToken, credentials })
  }
)
