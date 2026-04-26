import { createWorkflow, WorkflowData, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import {
  takeoverProductStep,
  TakeoverProductInput,
} from "../steps/takeover-product-from-google"
import { syncProductToGoogleStep } from "../steps/sync-product-to-google"

export const takeoverProductFromGoogleWorkflow = createWorkflow(
  "takeover-product-from-google",
  (input: WorkflowData<TakeoverProductInput>) => {
    const takeover = takeoverProductStep(input)
    const sync = syncProductToGoogleStep({
      product_id: input.product_id,
      account_id: input.account_id,
      takeover: true,
    })
    return new WorkflowResponse({ takeover, sync })
  }
)
