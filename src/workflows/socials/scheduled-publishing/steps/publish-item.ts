import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { SOCIALS_MODULE } from "../../../../modules/socials"
import { GeneratedContent } from "../../../../modules/socials/types/publishing-automation"
import { publishSocialPostUnifiedWorkflow } from "../../publish-social-post-unified"

/**
 * Publish Item Step
 * 
 * Creates a social post from generated content and publishes it.
 */
export const publishItemStep = createStep(
  "publish-campaign-item",
  async (
    input: {
      content: GeneratedContent
      platform_id: string
      campaign_name: string
      item_index: number
      transaction_id: string
    },
    { container }
  ) => {
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
    const socialsService = container.resolve(SOCIALS_MODULE)
    
    logger.info(`[Campaign] Publishing item ${input.item_index}: ${input.content.product_title}`)
    
    // Create the social post
    const postData = {
      platform_id: input.platform_id,
      name: `${input.campaign_name} - ${input.content.product_title}`,
      caption: input.content.caption,
      media_attachments: input.content.media_attachments as any,
      status: "draft" as const,
      related_item_type: "product",
      related_item_id: input.content.product_id,
      metadata: {
        campaign_workflow_id: input.transaction_id,
        campaign_name: input.campaign_name,
        campaign_item_index: input.item_index,
        auto_generated: true,
        hashtags: input.content.hashtags,
      },
    }
    
    const post = await socialsService.createSocialPosts(postData as any)
    logger.info(`[Campaign] Created social post: ${post.id}`)
    
    // Publish the post using the unified workflow
    try {
      const { result } = await publishSocialPostUnifiedWorkflow(container).run({
        input: { post_id: post.id },
      })
      
      if (result.success) {
        logger.info(`[Campaign] Successfully published: ${post.id}`)
        return new StepResponse({
          success: true,
          social_post_id: post.id,
          post_url: result.post?.post_url || null,
          error: null,
        })
      } else {
        logger.error(`[Campaign] Publish failed for post ${post.id}`)
        return new StepResponse({
          success: false,
          social_post_id: post.id,
          post_url: null,
          error: "Publishing failed",
        })
      }
    } catch (error: any) {
      logger.error(`[Campaign] Publish error: ${error.message}`)
      
      // Update post with error
      await socialsService.updateSocialPosts({
        id: post.id,
        status: "failed",
        error_message: error.message,
      })
      
      return new StepResponse({
        success: false,
        social_post_id: post.id,
        post_url: null,
        error: error.message,
      })
    }
  }
)
