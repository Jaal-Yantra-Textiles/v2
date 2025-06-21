import { MedusaError } from "@medusajs/utils"
import SocialPlatform from "../../modules/socials/models/SocialPlatform"
import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowData,
  transform,
  WorkflowResponse,
} from "@medusajs/workflows-sdk"
import SocialProviderService from "../../modules/social-provider/service"
import { SOCIAL_PROVIDER_MODULE } from "../../modules/social-provider"
import SocialsService from "../../modules/socials/service"
import { SOCIALS_MODULE } from "../../modules/socials"


interface ExchangeTokenStepInput {
  id: string
  platform: string
  code: string
  codeVerifier: string
}

const exchangeTokenStep = createStep(
  "exchange-token-step",
  async (input: ExchangeTokenStepInput, { container }) => {
    const socialProviderService = container.resolve(
      SOCIAL_PROVIDER_MODULE
    ) as SocialProviderService

    const provider = socialProviderService.getProvider(input.platform)

    if (typeof (provider as any).exchangeCodeForToken !== "function") {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Provider ${input.platform} does not support token exchange`
      )
    }

    const tokenData = await (provider as any).exchangeCodeForToken(
      input.code,
      input.codeVerifier
    )

    return new StepResponse(tokenData)
  }
)

interface CreateSocialPlatformStepInput {
  id: string
  provider: string
  provider_key: string
  access_token: string
  refresh_token?: string
  token_type?: string
  scope?: string
  expires_in?: number
  retrieved_at: Date
}

const createSocialPlatformStep = createStep(
  "create-social-platform-step",
  async (input: CreateSocialPlatformStepInput, { container }) => {
    const socialsService: SocialsService = container.resolve(SOCIALS_MODULE)

    const platform = await socialsService.updateSocialPlatforms({
        selector: {
            id: input.id
        },
        data: {
            api_config: {
                ...input
            }
        }
    })

    return new StepResponse(platform)
  }
)

export const exchangeTokenWorkflow = createWorkflow(
  "exchange-token-workflow",
  function (input: WorkflowData<ExchangeTokenStepInput>) {
    const tokenData = exchangeTokenStep(input)

    const platformInput = transform(
      { data: tokenData, input },
      ({ data, input }) => {
        return {
          id: input.id,
          provider: input.platform,
          provider_key: data.access_token, // Or a user ID if available
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          token_type: data.token_type,
          scope: data.scope,
          expires_in: data.expires_in,
          retrieved_at: new Date(data.retrieved_at),
        }
      }
    )

    const updatedPlatforms = createSocialPlatformStep(platformInput)

    // The step returns an array, so we extract the first element.
    const updatedPlatform = transform(updatedPlatforms, (platforms) => platforms[0])

    return new WorkflowResponse(updatedPlatform)
  }
)
