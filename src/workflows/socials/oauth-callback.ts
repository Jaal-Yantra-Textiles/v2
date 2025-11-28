import {
  createWorkflow,
  WorkflowResponse,
  when,
  transform,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { exchangeOAuthCodeStep } from "./steps/exchange-oauth-code"
import { encryptAndStorePlatformTokensStep } from "./steps/encrypt-and-store-platform-tokens"
import { fetchPlatformMetadataStep } from "./steps/fetch-platform-metadata"

export type OAuthCallbackWorkflowInput = {
  platform_id: string
  platform: string
  code: string
  state?: string
  redirect_uri?: string
}

export type OAuthCallbackWorkflowOutput = {
  platform: any
  success: boolean
}

export const oauthCallbackWorkflow = createWorkflow(
  "oauth-callback-workflow",
  (input: OAuthCallbackWorkflowInput) => {
    const logger = transform({ input }, ({ input }) => {
      const logger = (global as any).__container__?.resolve(ContainerRegistrationKeys.LOGGER)
      logger?.info(`[OAuth Callback Workflow] Starting for platform: ${input.platform}`)
      return logger
    })

    // Step 1: Exchange OAuth code for tokens
    const tokenData = exchangeOAuthCodeStep({
      platform: input.platform,
      code: input.code,
      state: input.state,
      redirect_uri: input.redirect_uri,
    })

    // Step 2: Fetch platform-specific metadata (conditional based on platform)
    const metadata = when(input, (i) => 
      ["facebook", "instagram", "twitter", "x"].includes(i.platform.toLowerCase())
    ).then(() => {
      return fetchPlatformMetadataStep({
        platform: input.platform,
        access_token: tokenData.access_token,
        token_data: tokenData,
      })
    })

    // Step 3: Encrypt and store tokens with platform-specific logic
    const updatedPlatform = encryptAndStorePlatformTokensStep({
      platform_id: input.platform_id,
      platform: input.platform,
      token_data: tokenData,
      metadata: metadata,
    })

    return new WorkflowResponse({
      platform: updatedPlatform,
      success: true,
    })
  }
)
