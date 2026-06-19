/**
 * @file Pure helpers for partner image segmentation.
 * @module API/Partners/Designs/Segment
 *
 * Roadmap #6/#337 — promote admin Designs to partner-ui. These mirror the
 * input-validation + fal-result-extraction logic of
 * `POST /admin/designs/:id/segment` so the partner route can reuse the exact
 * same behaviour while staying unit-testable without network/fal access.
 */
import { MedusaError } from "@medusajs/framework/utils"

export type SegmentInputBody = {
  image_url?: string
  image_base64?: string
  model?: string
}

export type ParsedSegmentInput =
  | { kind: "url"; imageUrl: string }
  | { kind: "base64"; mimeType: string; content: string; extension: string }

/**
 * Validate the segmentation request body and resolve which input mode was
 * supplied. Mirrors admin's branch: prefer `image_url`; otherwise parse the
 * `image_base64` data-URL. Throws `MedusaError` (INVALID_DATA) on a missing or
 * malformed input — never returns an ambiguous value.
 */
export function parseSegmentInput(
  body: SegmentInputBody | null | undefined
): ParsedSegmentInput {
  const image_url = body?.image_url
  const image_base64 = body?.image_base64

  if (!image_url && !image_base64) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Either image_url or image_base64 is required"
    )
  }

  if (image_url) {
    return { kind: "url", imageUrl: image_url }
  }

  const match = (image_base64 as string).match(/^data:([^;]+);base64,(.+)$/)
  if (!match) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "image_base64 must be a valid base64 data URL"
    )
  }
  const [, mimeType, content] = match
  const extension = mimeType.split("/")[1] || "png"
  return { kind: "base64", mimeType, content, extension }
}

export type SegmentOutput = { cutout_url: string; mask_url: string | null }

/**
 * Extract the cutout + mask URLs from a fal BiRefNet result. Mirrors admin's
 * shape read (`data.image.url` / `data.mask_image.url`) and throws
 * UNEXPECTED_STATE when fal returned no cutout image.
 */
export function extractSegmentOutput(result: any): SegmentOutput {
  const data = result?.data as any
  const cutoutUrl = data?.image?.url
  const maskUrl = data?.mask_image?.url

  if (!cutoutUrl) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "BiRefNet returned no image"
    )
  }

  return { cutout_url: cutoutUrl, mask_url: maskUrl || null }
}
