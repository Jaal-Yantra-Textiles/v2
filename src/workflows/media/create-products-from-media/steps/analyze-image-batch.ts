import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import { generateObject } from "ai"
import { z } from "@medusajs/framework/zod"

export type AnalyzeImageBatchInput = {
    mediaFiles: Array<{
        id: string
        file_name: string
        file_path: string
        mime_type: string
        metadata?: any
    }>
    batchSize?: number
}

const productAnalysisSchema = z.object({
    title: z.string(),
    description: z.string(),
    category: z.string().optional(),
    features: z.array(z.string()).optional(),
    colors: z.array(z.string()).optional(),
    material: z.string().optional(),
    suggested_price: z.number().optional(),
    confidence: z.number().min(0).max(1).optional(),
})

export const analyzeImageBatchStep = createStep(
    "analyze-image-batch-step",
    async (input: AnalyzeImageBatchInput, { container }) => {
        const batchSize = input.batchSize || 5
        const analyzedProducts: Array<{
            media_id: string
            media_url: string
            analysis: any
            cached?: boolean
            error?: string
        }> = []

        // Process in batches to avoid overwhelming the vision API
        for (let i = 0; i < input.mediaFiles.length; i += batchSize) {
            const batch = input.mediaFiles.slice(i, i + batchSize)

            // Process batch in parallel
            const batchResults = await Promise.all(
                batch.map(async (media) => {
                    try {
                        // Check if already analyzed (cached in metadata)
                        if (media.metadata?.ai_product_analysis) {
                            return {
                                media_id: media.id,
                                media_url: media.file_path,
                                analysis: media.metadata.ai_product_analysis,
                                cached: true,
                            }
                        }

                        // Analyze image with vision model
                        const openrouter = createOpenRouter({
                            apiKey: process.env.OPENROUTER_API_KEY,
                        })

                        const prompt = `Analyze this product image and extract:
1. Product title/name
2. Detailed product description
3. Suggested category
4. Key features
5. Visible colors
6. Material type (if identifiable)
7. Suggested price in USD
8. Confidence score (0-1)

Return structured JSON.`

                        const result = await generateObject({
                            model: openrouter("google/gemini-2.0-flash-exp:free") as any,
                            messages: [
                                {
                                    role: "user",
                                    content: [
                                        { type: "image", image: media.file_path },
                                        { type: "text", text: prompt },
                                    ],
                                },
                            ],
                            schema: productAnalysisSchema,
                        })

                        return {
                            media_id: media.id,
                            media_url: media.file_path,
                            analysis: result.object,
                            cached: false,
                        }
                    } catch (error) {
                        console.error(`Failed to analyze image ${media.id}:`, error)
                        return {
                            media_id: media.id,
                            media_url: media.file_path,
                            analysis: null,
                            error: error instanceof Error ? error.message : String(error),
                        }
                    }
                })
            )

            analyzedProducts.push(...batchResults)

            // Small delay between batches to avoid rate limiting
            if (i + batchSize < input.mediaFiles.length) {
                await new Promise((resolve) => setTimeout(resolve, 1000))
            }
        }

        // Filter out failed analyses
        const successfulAnalyses = analyzedProducts.filter((ap) => ap.analysis !== null)

        return new StepResponse(
            {
                analyzedProducts: successfulAnalyses,
                totalAnalyzed: successfulAnalyses.length,
                totalFailed: analyzedProducts.length - successfulAnalyses.length,
            },
            { analyzedProducts: successfulAnalyses }
        )
    },
    async (compensateData, { container }) => {
        // No rollback needed for analysis
    }
)
