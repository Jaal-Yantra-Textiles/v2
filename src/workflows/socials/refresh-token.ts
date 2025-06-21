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
  async (platform: SocialPlatform, { container }) => {
    const socialProviderService = container.resolve<SocialProviderService>(
      SOCIAL_PROVIDER_MODULE
    )

    const token = platform.api_config?.token

    // If no token or no refresh token, there's nothing to do.
    if (!token?.refresh_token) {
      return new StepResponse(token)
    }

    const provider = socialProviderService.getProvider(platform.name)
    if (!provider.refreshAccessToken) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Provider ${platform.name} does not support token refresh`
      )
    }

    console.log(`Attempting to refresh token for ${platform.name}...`)
    const newToken = await provider.refreshAccessToken(token.refresh_token)

    // Return the complete, updated token object
    return new StepResponse({ ...token, ...newToken, retrieved_at: Date.now() })
  }
)

// Step 3: Update the platform with the new token
const updatePlatformStep = createStep(
  "update-platform-step",
  async (
    input: { platform: SocialPlatform; token: OAuth2Token },
    { container }
  ) => {
    const service = container.resolve<SocialsService>(SOCIALS_MODULE)

    // Construct the new api_config by merging the new token
    const api_config = {
      ...(input.platform.api_config || {}),
      token: input.token,
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
      token: refreshedToken,
    })

    return new WorkflowResponse(updatedPlatform)
  }
)
