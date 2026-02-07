import { createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { fetchMediaFilesStep } from "../steps/fetch-media-files"
import { analyzeImageBatchStep } from "../steps/analyze-image-batch"
import { createProductsBatchStep } from "../steps/create-products-batch"

export type BatchCreateProductsInput = {
    folder_name?: string
    folder_id?: string
    media_ids?: string[]
    batch_size?: number
    auto_publish?: boolean
}

export const batchCreateProductsWorkflow = createWorkflow(
    "batch-create-products-from-media",
    (input: BatchCreateProductsInput) => {
        // Step 1: Fetch media files
        const { mediaFiles, totalCount } = fetchMediaFilesStep({
            folder_name: input.folder_name,
            folder_id: input.folder_id,
            media_ids: input.media_ids,
        })

        // Step 2: Analyze images in batches
        const { analyzedProducts, totalAnalyzed, totalFailed } = analyzeImageBatchStep({
            mediaFiles,
            batchSize: input.batch_size || 5,
        })

        // Step 3: Create products
        const { createdProducts, totalCreated } = createProductsBatchStep({
            analyzedProducts,
            auto_publish: input.auto_publish || false,
        })

        return new WorkflowResponse({
            totalImages: totalCount,
            totalAnalyzed,
            totalFailed,
            totalCreated,
            createdProducts,
        })
    }
)
