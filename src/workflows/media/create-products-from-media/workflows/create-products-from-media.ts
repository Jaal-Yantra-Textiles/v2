import {
    createWorkflow,
    WorkflowResponse,
    WorkflowData,
    transform,
} from "@medusajs/framework/workflows-sdk"
import {
    notifyOnFailureStep,
    sendNotificationsStep,
} from "@medusajs/medusa/core-flows"
import { waitConfirmationMediaProductStep } from "../steps/wait-confirmation"
import { batchCreateProductsWorkflow } from "./batch-create-products"

export const createProductsFromMediaWorkflowId = "create-products-from-media"

export type CreateProductsFromMediaInput = {
    folder_name?: string
    folder_id?: string
    media_ids?: string[]
    batch_size?: number
    auto_publish?: boolean
}

export type CreateProductsFromMediaSummary = {
    totalImages: number
    message: string
}

export const createProductsFromMediaWorkflow = createWorkflow(
    {
        name: createProductsFromMediaWorkflowId,
        store: true, // Store workflow state for long-running execution
    },
    (
        input: WorkflowData<CreateProductsFromMediaInput>
    ): WorkflowResponse<CreateProductsFromMediaSummary> => {
        // Create summary for user confirmation
        const summary = transform({ input }, (data) => {
            const source = data.input.folder_name
                ? `folder "${data.input.folder_name}"`
                : data.input.media_ids
                    ? `${data.input.media_ids.length} selected images`
                    : "media files"

            return {
                totalImages: data.input.media_ids?.length || 0,
                message: `Ready to create products from ${source}. Confirm to start processing.`,
            }
        })

        // Wait for user confirmation
        waitConfirmationMediaProductStep()

        // Failure notification
        const failureNotification = transform({ input }, (data) => {
            return [
                {
                    to: "",
                    channel: "feed" as const,
                    template: "admin-ui" as const,
                    data: {
                        title: "Product Creation Failed",
                        description: `Failed to create products from media files.`,
                    },
                },
            ]
        })

        notifyOnFailureStep(failureNotification)

        // Run batch processing in background
        const result = batchCreateProductsWorkflow
            .runAsStep({ input })
            .config({ async: true, backgroundExecution: true })

        // Success notification
        const successNotification = transform({ input, result }, (data) => {
            const source = data.input.folder_name
                ? `folder "${data.input.folder_name}"`
                : data.input.media_ids
                    ? `${data.input.media_ids.length} images`
                    : "media files"

            return [
                {
                    to: "",
                    channel: "feed" as const,
                    template: "admin-ui" as const,
                    data: {
                        title: "Product Creation Started",
                        description: `Processing ${source} in background. You'll be notified when complete.`,
                    },
                },
            ]
        })

        sendNotificationsStep(successNotification)

        return new WorkflowResponse(summary)
    }
)
