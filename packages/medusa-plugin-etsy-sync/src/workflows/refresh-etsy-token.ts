import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { ETSY_SYNC_MODULE } from "../modules/etsy-sync"
import EtsySyncService from "../modules/etsy-sync/service"

export const REFRESH_ETSY_TOKEN = "etsy-refresh-token"

const refreshEtsyTokenStep = createStep(
  "etsy-refresh-token-step",
  async (_, { container }): Promise<StepResponse<{ refreshed: boolean }>> => {
    const service: EtsySyncService = container.resolve(ETSY_SYNC_MODULE)
    const account = await service.getActiveAccount()
    if (!account) {
      return new StepResponse({ refreshed: false })
    }
    await service.ensureFreshToken(account)
    return new StepResponse({ refreshed: true })
  }
)

export const refreshEtsyTokenWorkflow = createWorkflow(REFRESH_ETSY_TOKEN, () => {
  const result = refreshEtsyTokenStep()
  return new WorkflowResponse(result)
})
