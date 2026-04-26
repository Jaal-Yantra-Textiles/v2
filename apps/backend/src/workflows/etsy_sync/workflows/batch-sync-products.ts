import {
  createWorkflow,
  WorkflowData,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { batchSyncProductsStep } from "../steps/batch-sync-products"

export type BatchSyncProductsWorkflowInput = {
  product_ids: string[]
  etsy_account_id: string
  sync_job_id: string
}

/**
 * Background workflow that performs the actual Etsy sync for products.
 * This runs asynchronously after confirmation.
 */
export const batchSyncProductsWorkflow = createWorkflow(
  "batch-sync-products-to-etsy",
  (input: WorkflowData<BatchSyncProductsWorkflowInput>) => {
    const result = batchSyncProductsStep(input)
    return new WorkflowResponse(result)
  }
)
