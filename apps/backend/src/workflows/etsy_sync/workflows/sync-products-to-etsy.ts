import {
  WorkflowData,
  WorkflowResponse,
  createStep,
  createWorkflow,
  StepResponse,
  transform,
} from "@medusajs/framework/workflows-sdk"
import { ETSYSYNC_MODULE } from "../../../modules/etsysync"
import EtsysyncService from "../../../modules/etsysync/service"
import {
  notifyOnFailureStep,
  sendNotificationsStep,
} from "@medusajs/medusa/core-flows"
import { waitConfirmationEtsySyncStep } from "../steps/wait-confirmation-etsy-sync"
import { createProductEtsyLinksStep } from "../steps/create-product-etsy-links"
import { batchSyncProductsWorkflow } from "./batch-sync-products"

export const syncProductsToEtsyWorkflowId = "sync-products-to-etsy"

export type SyncProductsToEtsyInput = {
  product_ids: string[]
  etsy_account_id: string
}

export type SyncProductsToEtsySummary = {
  total: number
}

const createEtsySyncJobStep = createStep(
  "create-etsy-sync-job-step",
  async (
    input: { transaction_id: string } & SyncProductsToEtsyInput,
    { container }
  ) => {
    const service: EtsysyncService = container.resolve(ETSYSYNC_MODULE)

    const job = await service.createEtsy_sync_jobs({
      transaction_id: input.transaction_id,
      status: "pending",
      total_products: input.product_ids.length,
      synced_count: 0,
      failed_count: 0,
      error_log: {},
      started_at: new Date(),
      completed_at: null,
    } as any)

    return new StepResponse(job, job.id)
  },
  async (jobId: string, { container }) => {
    const service: EtsysyncService = container.resolve(ETSYSYNC_MODULE)

    if (!jobId) {
      return
    }

    await service.softDeleteEtsy_sync_jobs(jobId)
  }
)

export const syncProductsToEtsyWorkflow = createWorkflow(
  syncProductsToEtsyWorkflowId,
  (
    input: WorkflowData<SyncProductsToEtsyInput>
  ): WorkflowResponse<SyncProductsToEtsySummary> => {
    const summary = transform({ input }, (data) => ({
      total: data.input.product_ids.length,
    }))

    // Create tracking job tied to transaction id
    const job = createEtsySyncJobStep(
      transform({ input }, (data, ctx) => ({
        ...data.input,
        transaction_id: ctx.transactionId!,
      }))
    )

    // Create pending links for all products
    createProductEtsyLinksStep(input)

    // Wait for confirmation from admin before starting background sync
    waitConfirmationEtsySyncStep()

    const failureNotification = transform({ input }, (data) => {
      return [
        {
          to: "",
          channel: "feed" as const,
          template: "admin-ui" as const,
          data: {
            title: "Etsy product sync",
            description: `Failed to sync ${data.input.product_ids.length} products to Etsy`,
          },
        },
      ]
    })

    notifyOnFailureStep(failureNotification)

    // Run batch sync in background
    batchSyncProductsWorkflow
      .runAsStep({
        input: transform({ input, job }, (data) => ({
          product_ids: data.input.product_ids,
          etsy_account_id: data.input.etsy_account_id,
          sync_job_id: data.job.id,
        })),
      })
      .config({ async: true, backgroundExecution: true })

    const successNotification = transform({ input }, (data) => {
      return [
        {
          to: "",
          channel: "feed" as const,
          template: "admin-ui" as const,
          data: {
            title: "Etsy product sync",
            description: `Etsy sync for ${data.input.product_ids.length} products started in background`,
          },
        },
      ]
    })

    sendNotificationsStep(successNotification)

    return new WorkflowResponse(summary)
  }
)
