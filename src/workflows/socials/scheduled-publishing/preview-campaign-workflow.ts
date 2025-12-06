import {
  createStep,
  createWorkflow,
  WorkflowResponse,
  StepResponse,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { SOCIALS_MODULE } from "../../../modules/socials"
import { ContentGeneratorService } from "../../../modules/socials/services/content-generator-service"
import { 
  ContentRule, 
  CampaignPreview,
  GeneratedContent,
} from "../../../modules/socials/types/publishing-automation"

/**
 * Preview Campaign Workflow
 * 
 * Generates a preview of all content that would be published in a campaign.
 * Does NOT publish anything - just generates and validates content.
 */

export interface PreviewCampaignInput {
  /** Campaign name */
  name: string
  
  /** Product IDs to preview */
  product_ids: string[]
  
  /** Platform ID */
  platform_id: string
  
  /** Content rule to apply */
  content_rule: ContentRule
  
  /** Hours between each publish */
  interval_hours: number
  
  /** Start date/time */
  start_at?: string
}

/**
 * Generate all previews step
 */
const generateAllPreviewsStep = createStep(
  "generate-all-previews",
  async (input: PreviewCampaignInput, { container }) => {
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const socialsService = container.resolve(SOCIALS_MODULE)
    
    logger.info(`[Campaign Preview] Generating preview for ${input.product_ids.length} products`)
    
    // Load platform
    const [platform] = await socialsService.listSocialPlatforms({ id: input.platform_id })
    if (!platform) {
      throw new Error(`Platform not found: ${input.platform_id}`)
    }
    const platformName = (platform as any).name || "Unknown"
    
    const generator = new ContentGeneratorService()
    const startTime = input.start_at ? new Date(input.start_at) : new Date()
    const intervalMs = input.interval_hours * 60 * 60 * 1000
    
    const items: Array<{
      position: number
      product_id: string
      product_title: string
      scheduled_at: Date
      generated_content: GeneratedContent
    }> = []
    
    const warnings: Array<{ product_id: string; message: string }> = []
    
    // Process each product
    for (let i = 0; i < input.product_ids.length; i++) {
      const productId = input.product_ids[i]
      const scheduledAt = new Date(startTime.getTime() + (i * intervalMs))
      
      try {
        // Load product
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
          filters: { id: productId },
        })
        
        const product = products?.[0]
        if (!product) {
          warnings.push({ product_id: productId, message: "Product not found" })
          continue
        }
        
        // Try to load design
        let design: any = null
        try {
          const { data: productDesignLinks } = await query.graph({
            entity: "product_design",
            fields: ["design.*"],
            filters: { product_id: productId },
          })
          design = productDesignLinks?.[0]?.design || null
        } catch {
          // Design link might not exist
        }
        
        // Generate content
        const content = await generator.generateContent(product as any, design, input.content_rule)
        
        // Validate
        const validation = generator.validateContent(content, platformName)
        validation.warnings.forEach(w => {
          warnings.push({ product_id: productId, message: w })
        })
        
        items.push({
          position: i,
          product_id: productId,
          product_title: product.title,
          scheduled_at: scheduledAt,
          generated_content: content,
        })
        
        logger.info(`[Campaign Preview] Generated content for: ${product.title}`)
        
      } catch (error: any) {
        logger.error(`[Campaign Preview] Error processing ${productId}: ${error.message}`)
        warnings.push({ product_id: productId, message: error.message })
      }
    }
    
    const preview: CampaignPreview = {
      name: input.name,
      platform: {
        id: input.platform_id,
        name: platformName,
      },
      content_rule: input.content_rule,
      items,
      warnings,
    }
    
    logger.info(`[Campaign Preview] Generated ${items.length} previews with ${warnings.length} warnings`)
    
    return new StepResponse(preview)
  }
)

export const previewCampaignWorkflow = createWorkflow(
  "preview-campaign",
  (input: PreviewCampaignInput) => {
    const preview = generateAllPreviewsStep(input)
    return new WorkflowResponse(preview)
  }
)

export default previewCampaignWorkflow
