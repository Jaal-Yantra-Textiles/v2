/**
 * @file Partner API route for image segmentation on a design.
 * @module API/Partners/Designs/Segment
 *
 * Roadmap #6/#337 — promote admin Designs to partner-ui. Mirrors
 * `POST /admin/designs/:id/segment` (fal.ai BiRefNet v2 background removal,
 * same `{ segment: { cutout_url, mask_url } }` response shape), but:
 *  - guarded to the OWNING partner via `assertPartnerOwnsDesign`, and
 *  - metered by the same free-tier soft-paywall as `/partners/ai/describe-image`
 *    (`AI_USAGE_MODULE`, operation `image_segment`) so partner fal cost is
 *    bounded. Quota is recorded BEFORE the expensive call so it can't be raced.
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { assertPartnerOwnsDesign } from "../../helpers"
import { resolveFalCredentials } from "../../../../../mastra/services/fal-credentials"
import { AI_USAGE_MODULE } from "../../../../../modules/ai_usage"
import type AiUsageService from "../../../../../modules/ai_usage/service"
import {
  parseSegmentInput,
  extractSegmentOutput,
  SegmentInputBody,
} from "./segment-image"

/**
 * Segment an image for a partner-owned design (background removal).
 * @route POST /partners/designs/{designId}/segment
 *
 * @returns {Object} 200 - { segment: { cutout_url, mask_url }, usage }
 * @returns {Object} 402 - Monthly AI quota exhausted (upgrade required)
 * @throws {MedusaError} 400 - Missing/invalid image input
 * @throws {MedusaError} 401 - Partner authentication required
 * @throws {MedusaError} 403 - Design is not owned by this partner
 * @throws {MedusaError} 404 - Design not found
 */
export const POST = async (
  req: AuthenticatedMedusaRequest<SegmentInputBody> & {
    params: { designId: string }
  },
  res: MedusaResponse
) => {
  const { designId } = req.params

  // Ownership guard (401/403/404). Self-serve designs only.
  const { partner } = await assertPartnerOwnsDesign(req, designId)

  // Validate input before touching quota or fal (400 on bad input).
  const parsed = parseSegmentInput(req.validatedBody)
  const model = req.validatedBody?.model || "General Use (Light)"

  const aiUsage = req.scope.resolve(
    AI_USAGE_MODULE
  ) as unknown as AiUsageService

  // Soft-paywall: bounded free segmentations per calendar month per partner.
  // Mirrors describe-image — record BEFORE the expensive call so it can't be
  // raced; a failed fal call still consumes the slot (cheap behaviour until
  // real subscriptions add metering refunds).
  const quota = await aiUsage.checkQuota(partner.id, "image_segment")
  if (!quota.allowed) {
    res.status(402).json({
      upgrade_required: true,
      code: "ai_quota_exhausted",
      message:
        "You've used your free AI segmentations this month. Upgrade to keep going.",
      used: quota.used,
      limit: quota.limit,
    })
    return
  }

  const falKey = await resolveFalCredentials(req.scope as any)
  if (!falKey) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "FAL credentials not configured. Contact support to enable AI image tools."
    )
  }

  await aiUsage.recordUsage(partner.id, "image_segment", { designId })

  const { fal } = await import("@fal-ai/client")
  fal.config({ credentials: falKey })

  // Resolve the input image URL (upload base64 to fal storage first).
  let resolvedImageUrl: string
  if (parsed.kind === "url") {
    resolvedImageUrl = parsed.imageUrl
  } else {
    const buffer = Buffer.from(parsed.content, "base64")
    const blob = new Blob([buffer], { type: parsed.mimeType })
    const file = new File([blob], `segment-input.${parsed.extension}`, {
      type: parsed.mimeType,
    })
    resolvedImageUrl = await fal.storage.upload(file)
  }

  const result = await fal.subscribe("fal-ai/birefnet/v2", {
    input: {
      image_url: resolvedImageUrl,
      model,
      operating_resolution: "1024x1024",
      output_format: "png",
      output_mask: true,
      refine_foreground: true,
    } as any,
  })

  const segment = extractSegmentOutput(result)

  res.status(200).json({
    segment,
    usage: { used: quota.used + 1, limit: quota.limit },
  })
}
