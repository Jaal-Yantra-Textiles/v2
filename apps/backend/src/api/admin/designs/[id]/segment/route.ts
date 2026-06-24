import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { resolveFalCredentials } from "../../../../../mastra/services/fal-credentials"
import { SegmentImageReq } from "./validators"

/**
 * POST /admin/designs/:id/segment
 *
 * Accepts an image (URL or base64) and returns:
 *  - cutout_url  : the image with background removed (transparent PNG)
 *  - mask_url    : the binary mask (white = foreground, black = background)
 *
 * Uses fal.ai BiRefNet v2 for high-quality segmentation.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest<SegmentImageReq>,
  res: MedusaResponse
) => {
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const { image_url, image_base64, model } = req.validatedBody

  if (!image_url && !image_base64) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Either image_url or image_base64 is required"
    )
  }

  const falKey = await resolveFalCredentials(req.scope as any)
  if (!falKey) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "FAL credentials not configured. Add an AI provider with provider_type=fal and role=ai_image_gen in Settings → External Platforms, or set the FAL_KEY env var."
    )
  }

  const { fal } = await import("@fal-ai/client")
  fal.config({ credentials: falKey })

  // If base64, upload to fal storage first
  let resolvedImageUrl = image_url
  if (!resolvedImageUrl && image_base64) {
    const match = image_base64.match(/^data:([^;]+);base64,(.+)$/)
    if (!match) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "image_base64 must be a valid base64 data URL"
      )
    }
    const [, mimeType, base64Content] = match
    const extension = mimeType.split("/")[1] || "png"
    const buffer = Buffer.from(base64Content, "base64")
    const blob = new Blob([buffer], { type: mimeType })
    const file = new File([blob], `segment-input.${extension}`, {
      type: mimeType,
    })
    resolvedImageUrl = await fal.storage.upload(file)
  }

  logger.info(
    `[Segment] Running BiRefNet v2 on image: ${resolvedImageUrl!.substring(0, 80)}…`
  )

  const result = await fal.subscribe("fal-ai/birefnet/v2", {
    input: {
      image_url: resolvedImageUrl,
      model: model || "General Use (Light)",
      operating_resolution: "1024x1024",
      output_format: "png",
      output_mask: true,
      refine_foreground: true,
    } as any,
  })

  const data = result?.data as any
  const cutoutUrl = data?.image?.url
  const maskUrl = data?.mask_image?.url

  if (!cutoutUrl) {
    logger.error(
      `[Segment] BiRefNet result shape: ${JSON.stringify(result).substring(0, 300)}`
    )
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "BiRefNet returned no image"
    )
  }

  logger.info(`[Segment] Success — cutout: ${cutoutUrl.substring(0, 80)}…`)

  return res.status(200).json({
    segment: {
      cutout_url: cutoutUrl,
      mask_url: maskUrl || null,
    },
  })
}
