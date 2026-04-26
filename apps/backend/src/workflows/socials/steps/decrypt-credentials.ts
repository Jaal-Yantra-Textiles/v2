import { createStep, StepResponse } from "@medusajs/workflows-sdk"
import { MedusaError } from "@medusajs/utils"
import { decryptAccessToken } from "../../../modules/socials/utils/token-helpers"
import type { Logger } from "@medusajs/types"

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
    const logger = container.resolve("logger") as Logger
    const apiConfig = input.platform.api_config as Record<string, unknown>

    // Decrypt access token using helper (supports both encrypted and plaintext)
    let userAccessToken: string
    try {
      userAccessToken = decryptAccessToken(apiConfig, container)
      logger.info(`[Decrypt Credentials] ✓ Access token decrypted successfully`)
    } catch (error: any) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Failed to decrypt access token: ${error.message}`
      )
    }

    // Handle Twitter/X credentials (supports both OAuth 1.0a and OAuth 2.0)
    const credentials: any = { user_access_token: userAccessToken }

    if (input.platform_name === "twitter" || input.platform_name === "x") {
      const oauth1UserCreds = apiConfig.oauth1_credentials as Record<string, any> | undefined
      const oauth1AppCreds = (apiConfig.oauth1_app_credentials || apiConfig.app_credentials) as Record<string, any> | undefined

      // Check for OAuth 1.0a credentials
      const hasUserOAuth1 = oauth1UserCreds?.access_token && oauth1UserCreds?.access_token_secret
      const hasAppOAuth1 = (oauth1AppCreds?.consumer_key || oauth1AppCreds?.api_key) &&
                           (oauth1AppCreds?.consumer_secret || oauth1AppCreds?.api_secret)

      // Check for OAuth 2.0 credentials (access_token from the main decryption)
      const hasOAuth2 = !!userAccessToken && apiConfig.provider === "x"

      if (!hasUserOAuth1 && !hasAppOAuth1 && !hasOAuth2) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "Twitter requires authentication. Please complete OAuth flow or enable app-only access."
        )
      }

      credentials.oauth1_user = oauth1UserCreds
      credentials.oauth1_app = oauth1AppCreds
      credentials.oauth2_token = hasOAuth2 ? userAccessToken : undefined
      
      if (hasOAuth2) {
        logger.info(`[Decrypt Credentials] ✓ Twitter/X OAuth 2.0 credentials validated`)
      } else {
        logger.info(`[Decrypt Credentials] ✓ Twitter OAuth 1.0a credentials validated`)
      }
    }

    return new StepResponse({ user_access_token: userAccessToken, credentials })
  }
)
