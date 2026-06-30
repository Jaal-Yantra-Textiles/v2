import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
  WorkflowData,
  transform,
} from "@medusajs/framework/workflows-sdk"
import { Modules } from "@medusajs/framework/utils"
import { ETSY_SYNC_MODULE } from "../modules/etsy-sync"
import EtsySyncService from "../modules/etsy-sync/service"
import { syncProductToEtsyWorkflow } from "./sync-product-to-etsy"

export const SYNC_PRODUCTS_TO_ETSY = "etsy-sync-products-bulk"

export type SyncProductsToEtsyInput = {
  product_ids: string[]
}

const batchSyncStep = createStep(
  "etsy-batch-sync-step",
  async (
    input: { product_ids: string[] },
    { container }
  ): Promise<StepResponse<{ synced: number; failed: number; errors: Record<string, string> }>> => {
    const service: EtsySyncService = container.resolve(ETSY_SYNC_MODULE)

    const account = await service.getActiveAccount()
    if (!account) {
      throw new Error("Etsy account is not connected")
    }

    const batch = await service.createEtsySyncBatches({
      status: "processing",
      total_products: input.product_ids.length,
      synced_count: 0,
      failed_count: 0,
      error_log: {},
      started_at: new Date(),
    } as any)

    let synced = 0
    let failed = 0
    const errors: Record<string, string> = {}

    for (const product_id of input.product_ids) {
      try {
        await syncProductToEtsyWorkflow(container).run({
          input: { product_id },
        })
        synced++
      } catch (err: any) {
        failed++
        errors[product_id] = err.message || "Unknown error"
      }
      // Throttle to respect Etsy rate limits
      await new Promise((r) => setTimeout(r, 250))
    }

    await service.updateEtsySyncBatches({
      id: (batch as any).id,
      status: failed === input.product_ids.length ? "failed" : "completed",
      synced_count: synced,
      failed_count: failed,
      error_log: errors,
      completed_at: new Date(),
    } as any)

    return new StepResponse({ synced, failed, errors })
  }
)

export const syncProductsToEtsyWorkflow = createWorkflow(
  SYNC_PRODUCTS_TO_ETSY,
  (input: WorkflowData<SyncProductsToEtsyInput>) => {
    const result = batchSyncStep(input)
    return new WorkflowResponse(result)
  }
)
