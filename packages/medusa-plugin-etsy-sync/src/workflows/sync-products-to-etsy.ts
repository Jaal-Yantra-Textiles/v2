import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
  WorkflowData,
  transform,
} from "@medusajs/framework/workflows-sdk"
import { ETSY_SYNC_MODULE } from "../modules/etsy-sync"
import EtsySyncService from "../modules/etsy-sync/service"
import { syncProductToEtsyWorkflow } from "./sync-product-to-etsy"

export const SYNC_PRODUCTS_TO_ETSY = "etsy-sync-products-bulk"

export type SyncProductsToEtsyInput = {
  product_ids: string[]
}

// Etsy personal apps are capped at ~5 requests/sec (and 10k/day). A single
// product sync fans out to several calls (create + N image uploads + publish),
// so we pace *products* conservatively and let the client's 429 retry-after
// backoff absorb any burst over the per-second limit.
const BASE_DELAY_MS = 600
const MAX_DELAY_MS = 10_000
// Persist progress at most this often so a large batch doesn't hammer the DB.
const PROGRESS_EVERY = 5

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ── Step 1 (inline): open the batch so the HTTP caller gets an id to poll ──

const openBatchStep = createStep(
  "etsy-open-batch-step",
  async (
    input: { product_ids: string[] },
    { container, context }
  ): Promise<StepResponse<{ batch_id: string }>> => {
    const service: EtsySyncService = container.resolve(ETSY_SYNC_MODULE)

    const account = await service.getActiveAccount()
    if (!account) {
      throw new Error("Etsy account is not connected")
    }

    const batch = await service.createEtsySyncBatches({
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
  "etsy-process-batch-step",
  async (
    input: { batch_id: string; product_ids: string[] },
    { container }
  ): Promise<StepResponse<{ synced: number; failed: number }>> => {
    const service: EtsySyncService = container.resolve(ETSY_SYNC_MODULE)

    let synced = 0
    let failed = 0
    let delay = BASE_DELAY_MS
    const errors: Record<string, string> = {}

    const persistProgress = async () => {
      await service
        .updateEtsySyncBatches({
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
        await syncProductToEtsyWorkflow(container).run({ input: { product_id } })
        synced++
        // Ease off once things are flowing again.
        delay = Math.max(BASE_DELAY_MS, Math.floor(delay / 2))
      } catch (err: any) {
        failed++
        errors[product_id] = err?.message || "Unknown error"
        // A 429 bubbling all the way up means we're still over the limit even
        // after the client's own retries — widen the gap between products.
        if (/429|rate limit/i.test(errors[product_id])) {
          delay = Math.min(delay * 2, MAX_DELAY_MS)
        }
      }

      if ((i + 1) % PROGRESS_EVERY === 0) {
        await persistProgress()
      }
      // Throttle between products (skip the trailing sleep).
      if (i < input.product_ids.length - 1) {
        await sleep(delay)
      }
    }

    await service.updateEtsySyncBatches({
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

export const syncProductsToEtsyWorkflow = createWorkflow(
  SYNC_PRODUCTS_TO_ETSY,
  (input: WorkflowData<SyncProductsToEtsyInput>) => {
    const opened = openBatchStep(input)

    // Long-running: the HTTP request returns as soon as the batch is opened;
    // the actual per-product sync runs in the background workflow engine.
    processBatchStep(
      transform({ input, opened }, (data) => ({
        batch_id: data.opened.batch_id,
        product_ids: data.input.product_ids,
      }))
    ).config({ async: true, backgroundExecution: true })

    return new WorkflowResponse({ batch_id: opened.batch_id })
  }
)
