import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { createProductsWorkflow } from "@medusajs/medusa/core-flows"
import { Modules } from "@medusajs/framework/utils"

export type CreateProductsBatchInput = {
    analyzedProducts: Array<{
        media_id: string
        media_url: string
        analysis: {
            title: string
            description: string
            category?: string
            features?: string[]
            colors?: string[]
            material?: string
            suggested_price?: number
            confidence?: number
        }
    }>
    auto_publish?: boolean
}

export const createProductsBatchStep = createStep(
    "create-products-batch-step",
    async (input: CreateProductsBatchInput, { container }) => {
        const storeService = container.resolve(Modules.STORE) as any
        const [store] = await storeService.listStores({})

        if (!store?.default_sales_channel_id) {
            throw new Error("No default sales channel configured")
        }

        // Build product inputs
        const productInputs = input.analyzedProducts.map((ap) => ({
            title: ap.analysis.title,
            description: ap.analysis.description,
            status: input.auto_publish ? ("published" as const) : ("draft" as const),
            is_giftcard: false,
            discountable: true,
            thumbnail: ap.media_url,
            images: [{ url: ap.media_url }],
            metadata: {
                source: "media_file",
                media_id: ap.media_id,
                ai_analysis: ap.analysis,
                confidence: ap.analysis.confidence,
                category: ap.analysis.category,
                features: ap.analysis.features,
                colors: ap.analysis.colors,
                material: ap.analysis.material,
            },
            sales_channels: [{ id: store.default_sales_channel_id }],
            // Add default variant
            variants: [
                {
                    title: "Default",
                    sku: `MEDIA-${ap.media_id}-${Date.now()}`,
                    manage_inventory: false,
                    prices: ap.analysis.suggested_price
                        ? [
                            {
                                amount: Math.round(ap.analysis.suggested_price * 100),
                                currency_code: "usd",
                            },
                        ]
                        : [],
                },
            ],
        }))

        // Create products using Medusa's core workflow
        const { result } = await createProductsWorkflow(container).run({
            input: { products: productInputs },
        })

        return new StepResponse(
            {
                createdProducts: result,
                totalCreated: result?.length || 0,
            },
            { productIds: result?.map((p: any) => p.id) || [] }
        )
    },
    async (compensateData, { container }) => {
        // Rollback: Delete created products
        if (compensateData?.productIds && compensateData.productIds.length > 0) {
            const productService = container.resolve(Modules.PRODUCT) as any
            try {
                await productService.deleteProducts(compensateData.productIds)
            } catch (error) {
                console.error("Failed to rollback product creation:", error)
            }
        }
    }
)
