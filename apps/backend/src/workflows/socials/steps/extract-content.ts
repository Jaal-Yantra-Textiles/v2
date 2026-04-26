import { createStep, StepResponse } from "@medusajs/workflows-sdk"

/**
 * Step 6: Extract Content
 * 
 * Extracts post content (caption and media attachments).
 */
export const extractContentStep = createStep(
  "extract-content",
  async (input: { post: any }) => {
    const caption = (input.post.caption || "") as string
    const mediaAttachments = (input.post.media_attachments || []) as Array<{
      type: string
      url: string
    }>

    console.log(`[Extract Content] ✓ Caption length: ${caption.length}, Media: ${mediaAttachments.length}`)

    return new StepResponse({ caption, media_attachments: mediaAttachments })
  }
)
