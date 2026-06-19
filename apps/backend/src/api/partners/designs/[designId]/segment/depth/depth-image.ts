/**
 * @file Pure helpers for partner image depth/normal estimation.
 * @module API/Partners/Designs/Segment/Depth
 *
 * Roadmap #6/#337 — promote admin Designs to partner-ui. These mirror the
 * input-validation + fal-result-extraction logic of
 * `POST /admin/designs/:id/segment/depth` (fal.ai MiDaS preprocessor) so the
 * partner route can reuse the exact same behaviour while staying
 * unit-testable without network/fal access.
 */
import { MedusaError } from "@medusajs/framework/utils"

export type DepthInputBody = {
  image_url?: string
  image_base64?: string
}

export type ParsedDepthInput =
  | { kind: "url"; imageUrl: string }
  | { kind: "base64"; mimeType: string; content: string; extension: string }

/**
 * Validate the depth request body and resolve which input mode was supplied.
 * Mirrors admin's branch: prefer `image_url`; otherwise parse the
 * `image_base64` data-URL. Throws `MedusaError` (INVALID_DATA) on a missing or
 * malformed input — never returns an ambiguous value.
 */
export function parseDepthInput(
  body: DepthInputBody | null | undefined
): ParsedDepthInput {
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

export type DepthOutput = { depth_url: string; normal_url: string | null }

/**
 * Extract the depth + normal map URLs from a fal MiDaS result. Mirrors admin's
 * shape read (`data.depth_map.url` / `data.normal_map.url`) and throws
 * UNEXPECTED_STATE when MiDaS returned no depth map.
 */
export function extractDepthOutput(result: any): DepthOutput {
  const data = result?.data as any
  const depthUrl = data?.depth_map?.url
  const normalUrl = data?.normal_map?.url

  if (!depthUrl) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "MiDaS returned no depth map"
    )
  }

  return { depth_url: depthUrl, normal_url: normalUrl || null }
}
