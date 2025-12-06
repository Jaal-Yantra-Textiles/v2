import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * Load Product with Design Step
 * 
 * Loads a product and its linked design (if any) for content generation.
 */
export const loadProductWithDesignStep = createStep(
  "load-product-with-design",
  async (input: { product_id: string }, { container }) => {
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    
    logger.info(`[Campaign] Loading product: ${input.product_id}`)
    
    // Load product with images and variants
    const { data: products } = await query.graph({
      entity: "product",
      fields: [
        "id",
        "title",
        "description",
        "thumbnail",
        "images.*",
        "tags.*",
        "type.*",
        "variants.*",
        "variants.prices.*",
        "metadata",
      ],
      filters: { id: input.product_id },
    })
    
    const product = products?.[0]
    if (!product) {
      throw new Error(`Product not found: ${input.product_id}`)
    }
    
    logger.info(`[Campaign] Loaded product: ${product.title}`)
    
    // Try to load linked design
    let design: any = null
    try {
      const { data: productDesignLinks } = await query.graph({
        entity: "product_design",
        fields: ["design.*"],
        filters: { product_id: input.product_id },
      })
      
      if (productDesignLinks?.[0]?.design) {
        design = productDesignLinks[0].design
        logger.info(`[Campaign] Found linked design: ${design?.name}`)
      }
    } catch (error: any) {
      logger.warn(`[Campaign] Could not load design link: ${error.message}`)
    }
    
    return new StepResponse({ product, design })
  }
)
