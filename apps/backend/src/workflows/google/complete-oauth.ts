import {
  createWorkflow,
  WorkflowData,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import {
  exchangeGoogleOauthCodeStep,
  type ExchangeGoogleOauthCodeInput,
} from "./steps/exchange-google-oauth-code"
import { persistGoogleTokensStep } from "./steps/persist-google-tokens"

export const completeGoogleOauthWorkflowId = "complete-google-oauth-workflow"

/**
 * Two-step workflow:
 *   1. Exchange the auth code for tokens + identity (no DB writes).
 *   2. Encrypt and persist tokens, set status="active", clear transients.
 *
 * Splitting the steps means a network failure in step 1 leaves the row
 * unchanged — no half-written state.
 */
export const completeGoogleOauthWorkflow = createWorkflow(
  completeGoogleOauthWorkflowId,
  function (input: WorkflowData<ExchangeGoogleOauthCodeInput>) {
    const tokens = exchangeGoogleOauthCodeStep(input)
    const platform = persistGoogleTokensStep(tokens)
    return new WorkflowResponse(platform)
  }
)
