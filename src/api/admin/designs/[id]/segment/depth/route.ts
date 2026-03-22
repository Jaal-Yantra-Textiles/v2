import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

/**
 * POST /admin/designs/:id/segment/depth
 *
 * Accepts an image (URL or base64) and returns depth + normal maps
 * using fal.ai MiDaS preprocessor (one call, two outputs).
 *
 * Body: { image_url?: string, image_base64?: string }
 *
 * Returns:
 *  - depth_url  : grayscale depth map
 *  - normal_url : RGB normal map
 */
export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { image_url, image_base64 } = req.body as {
    image_url?: string
    image_base64?: string
  }

  if (!image_url && !image_base64) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Either image_url or image_base64 is required"
    )
  }

  if (!process.env.FAL_KEY) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "FAL_KEY environment variable is not configured"
    )
  }

  const { fal } = await import("@fal-ai/client")
  fal.config({ credentials: process.env.FAL_KEY })

  // Resolve image URL (upload base64 if needed)
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
    const file = new File([blob], `depth-input.${extension}`, {
      type: mimeType,
    })
    resolvedImageUrl = await fal.storage.upload(file)
  }

  console.log(
    `[Depth] Running MiDaS on image: ${resolvedImageUrl!.substring(0, 80)}…`
  )

  const result = await fal.subscribe("fal-ai/image-preprocessors/midas", {
    input: {
      image_url: resolvedImageUrl,
      a: 6.283185307179586,
      background_threshold: 0.1,
    } as any,
  })

  const data = result?.data as any
  const depthUrl = data?.depth_map?.url
  const normalUrl = data?.normal_map?.url

  if (!depthUrl) {
    console.error(
      "[Depth] MiDaS result shape:",
      JSON.stringify(result).substring(0, 400)
    )
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "MiDaS returned no depth map"
    )
  }

  console.log(`[Depth] Success — depth: ${depthUrl.substring(0, 80)}…`)

  return res.status(200).json({
    depth: {
      depth_url: depthUrl,
      normal_url: normalUrl || null,
    },
  })
}
