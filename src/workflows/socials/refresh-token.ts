import {
  createWorkflow,
  createStep,
  StepResponse,
  transform,
  WorkflowResponse,
  WorkflowData,
} from "@medusajs/workflows-sdk"
import { MedusaError } from "@medusajs/utils"
import SocialProviderService from "../../modules/social-provider/service"
import { SOCIAL_PROVIDER_MODULE } from "../../modules/social-provider"
import SocialsService from "../../modules/socials/service"
import { OAuth2Token, TwitterOAuth2Token } from "../../modules/social-provider/types"
import { SOCIALS_MODULE } from "../../modules/socials"
import { ENCRYPTION_MODULE } from "../../modules/encryption"
import EncryptionService from "../../modules/encryption/service"

// Define a more precise type for the entity instance
type SocialPlatform = {
  id: string
  name: string
  icon_url: string | null
  base_url: string | null
  api_config: {
    token?: OAuth2Token
    [key: string]: any
  } | null
}

// Step 1: Find the social platform
const findSocialPlatformStep = createStep(
  "find-social-platform-step",
  async (input: { id: string }, { container }) => {
    const service = container.resolve<SocialsService>(SOCIALS_MODULE)
    const platform = await service.retrieveSocialPlatform(input.id)
    if (!platform) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `SocialPlatform with id ${input.id} not found`
      )
    }
    return new StepResponse(platform as SocialPlatform)
  }
)

// Step 2: Refresh the token if needed
const refreshTokenStep = createStep(
  "refresh-token-step",
  async (platform: SocialPlatform, { container }): Promise<StepResponse<any>> => {
    const socialProviderService = container.resolve<SocialProviderService>(
      SOCIAL_PROVIDER_MODULE
    )
    const logger = container.resolve("logger")
    const apiConfig = platform.api_config

    // Check for nested token structure (legacy)
    const nestedToken = apiConfig?.token
    
    // Check for flat token structure (X/Twitter OAuth 2.0)
    const flatRefreshToken = (apiConfig as any)?.refresh_token
    const isFlat = !nestedToken?.refresh_token && flatRefreshToken

    // If no refresh token in either structure, nothing to do
    if (!nestedToken?.refresh_token && !flatRefreshToken) {
      logger.info(`No refresh token found for ${platform.name}, skipping`)
      return new StepResponse(nestedToken || null)
    }

    const provider = socialProviderService.getProvider(platform.name)
    if (!provider.refreshAccessToken) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Provider ${platform.name} does not support token refresh`
      )
    }

    const refreshToken = isFlat ? flatRefreshToken : nestedToken!.refresh_token
    logger.info(`Attempting to refresh token for ${platform.name}...`)
    const newToken = await provider.refreshAccessToken(refreshToken)

    if (isFlat) {
      // Return flat structure for X/Twitter
      return new StepResponse({
        ...apiConfig,
        access_token: newToken.access_token,
        refresh_token: newToken.refresh_token || refreshToken,
        expires_in: newToken.expires_in || 7200,
        retrieved_at: new Date().toISOString(),
        _isFlat: true, // Flag to indicate flat structure
      })
    }

    // Return nested structure (legacy)
    return new StepResponse({ ...nestedToken, ...newToken, retrieved_at: Date.now() })
  }
)

// Step 3: Update the platform with the new token (with encryption)
const updatePlatformStep = createStep(
  "update-platform-step",
  async (
    input: { platform: SocialPlatform; token: any },
    { container }
  ) => {
    const service = container.resolve<SocialsService>(SOCIALS_MODULE)
    const encryptionService = container.resolve(ENCRYPTION_MODULE) as EncryptionService
    const logger = container.resolve("logger")

    // Check if this is a flat structure (X/Twitter) or nested (legacy)
    const isFlat = input.token?._isFlat
    
    let api_config: any
    if (isFlat) {
      // Flat structure - update api_config directly with encrypted tokens
      const { _isFlat, access_token, refresh_token, ...otherData } = input.token
      
      api_config = {
        ...otherData,
        // Keep plaintext for backward compatibility (will be removed by decryptAccessToken helper)
        access_token,
        refresh_token,
        // Store encrypted versions
        access_token_encrypted: access_token 
          ? encryptionService.encrypt(access_token)
          : input.platform.api_config?.access_token_encrypted,
        refresh_token_encrypted: refresh_token
          ? encryptionService.encrypt(refresh_token)
          : input.platform.api_config?.refresh_token_encrypted,
      }
      logger.info(`Updating platform with flat token structure (encrypted)`)
    } else {
      // Nested structure - update token inside api_config
      const token = input.token
      if (token?.access_token) {
        token.access_token_encrypted = encryptionService.encrypt(token.access_token)
      }
      if (token?.refresh_token) {
        token.refresh_token_encrypted = encryptionService.encrypt(token.refresh_token)
      }
      
      api_config = {
        ...(input.platform.api_config || {}),
        token,
      }
      logger.info(`Updating platform with nested token structure (encrypted)`)
    }

    const [updatedPlatform] = await service.updateSocialPlatforms({
      selector: { id: input.platform.id },
      data: { api_config },
    })

    return new StepResponse(updatedPlatform)
  }
)

// The Long-Running Workflow
export const refreshTokenWorkflowId = "refresh-token-workflow"
export const refreshTokenWorkflow = createWorkflow(
  refreshTokenWorkflowId,
  function (input: WorkflowData<{ platformId: string }>) {
    const platform = findSocialPlatformStep({ id: input.platformId })
    const refreshedToken = refreshTokenStep(platform)

    const updatedPlatform = updatePlatformStep({
      platform: platform,
      token: refreshedToken as any,
    })

    return new WorkflowResponse(updatedPlatform)
  }
)
