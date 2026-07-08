import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { FAIRE_SYNC_MODULE } from "../modules/faire-sync"
import FaireSyncService from "../modules/faire-sync/service"

export const REFRESH_FAIRE_TOKEN = "faire-refresh-token"

const refreshFaireTokenStep = createStep(
  "faire-refresh-token-step",
  async (_, { container }): Promise<StepResponse<{ refreshed: boolean }>> => {
    const service: FaireSyncService = container.resolve(FAIRE_SYNC_MODULE)
    const account = await service.getActiveAccount()
    if (!account) {
      return new StepResponse({ refreshed: false })
    }
    await service.ensureFreshToken(account)
    return new StepResponse({ refreshed: true })
  }
)

export const refreshFaireTokenWorkflow = createWorkflow(REFRESH_FAIRE_TOKEN, () => {
  const result = refreshFaireTokenStep()
  return new WorkflowResponse(result)
})
