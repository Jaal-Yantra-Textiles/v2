import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
  WorkflowData,
  transform,
} from "@medusajs/framework/workflows-sdk"
import { FAIRE_SYNC_MODULE } from "../modules/faire-sync"
import FaireSyncService from "../modules/faire-sync/service"
import { syncProductToFaireWorkflow } from "./sync-product-to-faire"

export const SYNC_PRODUCTS_TO_FAIRE = "faire-sync-products-bulk"

export type SyncProductsToFaireInput = {
  product_ids: string[]
}

// Faire enforces a modest per-second request budget and a daily call ceiling.
// A single product sync fans out to several calls (create + inventory push),
// so we pace *products* conservatively and let the client's 429 retry-after
// backoff absorb bursts over the per-second limit.
const BASE_DELAY_MS = 600
const MAX_DELAY_MS = 10_000
const PROGRESS_EVERY = 5

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ── Step 1 (inline): open the batch so the HTTP caller gets an id to poll ──

const openBatchStep = createStep(
  "faire-open-batch-step",
  async (
    input: { product_ids: string[] },
    { container, context }
  ): Promise<StepResponse<{ batch_id: string }>> => {
    const service: FaireSyncService = container.resolve(FAIRE_SYNC_MODULE)

    const account = await service.getActiveAccount()
    if (!account) {
      throw new Error("Faire account is not connected")
    }

    const batch = await service.createFaireSyncBatches({
      transaction_id: context.transactionId,
      status: "processing",
      total_products: input.product_ids.length,
      synced_count: 0,
      failed_count: 0,
      error_log: {},
      started_at: new Date(),
    } as any)

    return new StepResponse({ batch_id: (batch as any).id })
  }
)

// ── Step 2 (async, background): process every product with backoff ─────────

const processBatchStep = createStep(
  "faire-process-batch-step",
  async (
    input: { batch_id: string; product_ids: string[] },
    { container }
  ): Promise<StepResponse<{ synced: number; failed: number }>> => {
    const service: FaireSyncService = container.resolve(FAIRE_SYNC_MODULE)

    let synced = 0
    let failed = 0
    let delay = BASE_DELAY_MS
    const errors: Record<string, string> = {}

    const persistProgress = async () => {
      await service
        .updateFaireSyncBatches({
          id: input.batch_id,
          synced_count: synced,
          failed_count: failed,
          error_log: errors,
        } as any)
        .catch(() => {})
    }

    for (let i = 0; i < input.product_ids.length; i++) {
      const product_id = input.product_ids[i]
      try {
        await syncProductToFaireWorkflow(container).run({ input: { product_id } })
        synced++
        delay = Math.max(BASE_DELAY_MS, Math.floor(delay / 2))
      } catch (err: any) {
        failed++
        errors[product_id] = err?.message || "Unknown error"
        if (/429|rate limit/i.test(errors[product_id])) {
          delay = Math.min(delay * 2, MAX_DELAY_MS)
        }
      }

      if ((i + 1) % PROGRESS_EVERY === 0) {
        await persistProgress()
      }
      if (i < input.product_ids.length - 1) {
        await sleep(delay)
      }
    }

    await service.updateFaireSyncBatches({
      id: input.batch_id,
      status: failed === input.product_ids.length ? "failed" : "completed",
      synced_count: synced,
      failed_count: failed,
      error_log: errors,
      completed_at: new Date(),
    } as any)

    return new StepResponse({ synced, failed })
  }
)

export const syncProductsToFaireWorkflow = createWorkflow(
  SYNC_PRODUCTS_TO_FAIRE,
  (input: WorkflowData<SyncProductsToFaireInput>) => {
    const opened = openBatchStep(input)

    processBatchStep(
      transform({ input, opened }, (data) => ({
        batch_id: data.opened.batch_id,
        product_ids: data.input.product_ids,
      }))
    ).config({ async: true, backgroundExecution: true })

    return new WorkflowResponse({ batch_id: opened.batch_id })
  }
)
