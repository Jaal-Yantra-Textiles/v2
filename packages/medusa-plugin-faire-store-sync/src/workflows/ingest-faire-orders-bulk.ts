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
import { ingestFaireOrderWorkflow } from "./ingest-faire-order"

export const INGEST_FAIRE_ORDERS_BULK = "faire-ingest-orders-bulk"

export type IngestFaireOrdersBulkInput = {
  // When omitted, pulls all available orders from Faire (paged).
  limit?: number
}

// Faire enforces a modest per-second request budget. Each order ingest fans
// out to several Medusa calls (create order + payment + optional inventory),
// so we pace *orders* conservatively and let the client's 429 retry-after
// backoff absorb bursts.
const BASE_DELAY_MS = 600
const MAX_DELAY_MS = 10_000
const PROGRESS_EVERY = 5
const PAGE_SIZE = 50

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ── Step 1 (inline): open the batch so the HTTP caller gets an id to poll ──

const openBatchStep = createStep(
  "faire-ingest-orders-open-batch-step",
  async (
    _input: IngestFaireOrdersBulkInput,
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
      total_products: 0, // populated as we discover orders (generic counter)
      synced_count: 0,
      failed_count: 0,
      error_log: {},
      started_at: new Date(),
    } as any)

    return new StepResponse({ batch_id: (batch as any).id })
  }
)

// ── Step 2 (async, background): page through Faire orders + ingest each ─────

const processBatchStep = createStep(
  "faire-ingest-orders-process-batch-step",
  async (
    input: { batch_id: string; limit?: number },
    { container }
  ): Promise<StepResponse<{ synced: number; failed: number }>> => {
    const service: FaireSyncService = container.resolve(FAIRE_SYNC_MODULE)
    const account = await service.ensureFreshToken()
    const client = service.getClient()

    let synced = 0
    let failed = 0
    let total = 0
    let delay = BASE_DELAY_MS
    const errors: Record<string, string> = {}

    const persistProgress = async () => {
      await service
        .updateFaireSyncBatches({
          id: input.batch_id,
          total_products: total,
          synced_count: synced,
          failed_count: failed,
          error_log: errors,
        } as any)
        .catch(() => {})
    }

    try {
      let page = 1
      let stop = false
      while (!stop) {
        const { results } = await client.listOrders(account.access_token, {
          limit: PAGE_SIZE,
          page,
        })
        if (!results.length) break
        total += results.length

        for (const order of results) {
          const token = order.order_token
          try {
            await ingestFaireOrderWorkflow(container).run({
              input: { order: order.raw, order_token: token },
            })
            // Skip === duplicate is still a successful no-op.
            synced++
            delay = Math.max(BASE_DELAY_MS, Math.floor(delay / 2))
          } catch (err: any) {
            failed++
            errors[token] = err?.message || "Unknown error"
            if (/429|rate limit/i.test(errors[token])) {
              delay = Math.min(delay * 2, MAX_DELAY_MS)
            }
          }

          if ((synced + failed) % PROGRESS_EVERY === 0) {
            await persistProgress()
          }
          await sleep(delay)
        }

        // Honor an explicit limit on total orders processed.
        if (input.limit != null && total >= input.limit) {
          stop = true
        }
        // Stop if the last page was short (no more pages).
        if (results.length < PAGE_SIZE) {
          stop = true
        }
        page++
      }
    } catch (err: any) {
      errors["__fetch__"] = err?.message || "Failed to list Faire orders"
    }

    await service.updateFaireSyncBatches({
      id: input.batch_id,
      total_products: total,
      status: failed === total && total > 0 ? "failed" : "completed",
      synced_count: synced,
      failed_count: failed,
      error_log: errors,
      completed_at: new Date(),
    } as any)

    return new StepResponse({ synced, failed })
  }
)

export const ingestFaireOrdersBulkWorkflow = createWorkflow(
  INGEST_FAIRE_ORDERS_BULK,
  (input: WorkflowData<IngestFaireOrdersBulkInput>) => {
    const opened = openBatchStep(input)

    // Long-running: the HTTP request returns as soon as the batch is opened;
    // the actual per-order ingest runs in the background workflow engine.
    processBatchStep(
      transform({ input, opened }, (data) => ({
        batch_id: data.opened.batch_id,
        limit: data.input.limit,
      }))
    ).config({ async: true, backgroundExecution: true })

    return new WorkflowResponse({ batch_id: opened.batch_id })
  }
)
