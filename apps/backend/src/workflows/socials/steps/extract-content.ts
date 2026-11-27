import { createStep, StepResponse } from "@medusajs/workflows-sdk"
import { readReelOptions } from "../../../modules/social-provider/reel"

/**
 * Step 6: Extract Content
 * 
 * Extracts post content (caption, media attachments, and Instagram Reels
 * options from `metadata.reel`).
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

    const reel = readReelOptions(input.post.metadata)

    return new StepResponse({ caption, media_attachments: mediaAttachments, reel })
  }
)
