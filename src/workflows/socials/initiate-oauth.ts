import { MedusaError } from "@medusajs/utils"
import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowData,
  WorkflowResponse,
} from "@medusajs/workflows-sdk"
import SocialProviderService from "../../modules/social-provider/service"
import { SOCIAL_PROVIDER_MODULE } from "../../modules/social-provider"

type InitiateOauthStepInput = {
  platform: string
  redirectUri: string
  scope: string
}

const initiateOauthStep = createStep(
  "initiate-oauth-step",
  async (input: InitiateOauthStepInput, { container }) => {
    const { platform, redirectUri, scope } = input

    const socialProviderService = container.resolve<SocialProviderService>(
      SOCIAL_PROVIDER_MODULE
    )
    const provider = socialProviderService.getProvider(platform.toLowerCase())

    if (typeof (provider as any).initiateUserAuth !== "function") {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Provider ${input.platform} does not support user auth initiation`
      )
    }

    const { authUrl, codeVerifier, state } = (provider as any).initiateUserAuth(
      redirectUri,
      scope
    )

    return new StepResponse({ authUrl, codeVerifier, state })
  }
)

export const initiateOauthWorkflowId = "initiate-oauth-workflow"
export const initiateOauthWorkflow = createWorkflow(
  initiateOauthWorkflowId,
  function (input: WorkflowData<InitiateOauthStepInput>) {
    const result = initiateOauthStep(input)
    return new WorkflowResponse(result)
  }
)
