import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { ContentRule, GeneratedContent } from "../../../../modules/socials/types/publishing-automation"
import { ContentGeneratorService } from "../../../../modules/socials/services/content-generator-service"

/**
 * Generate Content Step
 * 
 * Applies the content rule to a product to generate social media content.
 */
export const generateContentStep = createStep(
  "generate-content",
  async (
    input: {
      product: any
      design: any
      content_rule: ContentRule
      platform_name: string
    },
    { container }
  ) => {
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
    
    logger.info(`[Campaign] Generating content for: ${input.product.title}`)
    
    const generator = new ContentGeneratorService()
    
    // Generate content using the rule
    const content = await generator.generateContent(
      input.product,
      input.design,
      input.content_rule
    )
    
    // Validate content
    const validation = generator.validateContent(content, input.platform_name)
    
    if (validation.warnings.length > 0) {
      logger.warn(`[Campaign] Content warnings:`)
      validation.warnings.forEach(w => logger.warn(`  - ${w}`))
    }
    
    logger.info(`[Campaign] Generated caption (${content.caption.length} chars)`)
    logger.info(`[Campaign] Media attachments: ${content.media_attachments.length}`)
    logger.info(`[Campaign] Hashtags: ${content.hashtags.join(", ")}`)
    
    return new StepResponse({
      content,
      warnings: validation.warnings,
      valid: validation.valid,
    })
  }
)
