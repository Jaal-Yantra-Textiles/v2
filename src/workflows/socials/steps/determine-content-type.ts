import { createStep, StepResponse } from "@medusajs/workflows-sdk"

/**
 * Step 7: Determine Content Type
 * 
 * Analyzes media attachments to determine content type:
 * - carousel: Multiple images
 * - photo: Single image
 * - reel/video: Video attachment
 * - text: No media (caption only)
 */
export const determineContentTypeStep = createStep(
  "determine-content-type",
  async (input: { media_attachments: Array<{ type: string; url: string }>; caption: string }) => {
    const imageAttachments = input.media_attachments.filter((a) => a.type === "image")
    const videoAttachment = input.media_attachments.find((a) => a.type === "video")

    let contentType: "photo" | "video" | "text" | "reel" | "carousel" = "text"
    let imageUrl: string | undefined
    let imageUrls: string[] | undefined
    let videoUrl: string | undefined

    if (imageAttachments.length > 1) {
      contentType = "carousel"
      imageUrls = imageAttachments.map((a) => a.url)
    } else if (imageAttachments.length === 1) {
      contentType = "photo"
      imageUrl = imageAttachments[0].url
    } else if (videoAttachment) {
      contentType = "reel"
      videoUrl = videoAttachment.url
    } else if (input.caption) {
      contentType = "text"
    }

    console.log(`[Determine Content Type] ✓ Type: ${contentType}`)

    return new StepResponse({
      content_type: contentType,
      image_url: imageUrl,
      image_urls: imageUrls,
      video_url: videoUrl,
    })
  }
)
