/**
 * @file Partner API route for depth/normal-map estimation on a design.
 * @module API/Partners/Designs/Segment/Depth
 *
 * Roadmap #6/#337 — promote admin Designs to partner-ui. Mirrors
 * `POST /admin/designs/:id/segment/depth` (fal.ai MiDaS preprocessor — one call
 * returns a grayscale depth map + an RGB normal map), with the same
 * `{ depth: { depth_url, normal_url } }` response shape, but:
 *  - guarded to the OWNING partner via `assertPartnerOwnsDesign`, and
 *  - metered by the same free-tier soft-paywall as the other partner AI ops
 *    (`AI_USAGE_MODULE`, operation `image_depth`) so partner fal cost is
 *    bounded. Quota is recorded BEFORE the expensive call so it can't be raced.
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { assertPartnerOwnsDesign } from "../../../helpers"
import { resolveFalCredentials } from "../../../../../../mastra/services/fal-credentials"
import { AI_USAGE_MODULE } from "../../../../../../modules/ai_usage"
import type AiUsageService from "../../../../../../modules/ai_usage/service"
import {
  parseDepthInput,
  extractDepthOutput,
  DepthInputBody,
} from "./depth-image"

/**
 * Estimate depth + normal maps for a partner-owned design.
 * @route POST /partners/designs/{designId}/segment/depth
 *
 * @returns {Object} 200 - { depth: { depth_url, normal_url }, usage }
 * @returns {Object} 402 - Monthly AI quota exhausted (upgrade required)
 * @throws {MedusaError} 400 - Missing/invalid image input
 * @throws {MedusaError} 401 - Partner authentication required
 * @throws {MedusaError} 403 - Design is not owned by this partner
 * @throws {MedusaError} 404 - Design not found
 */
export const POST = async (
  req: AuthenticatedMedusaRequest<DepthInputBody> & {
    params: { designId: string }
  },
  res: MedusaResponse
) => {
  const { designId } = req.params

  // Ownership guard (401/403/404). Self-serve designs only.
  const { partner } = await assertPartnerOwnsDesign(req, designId)

  // Validate input before touching quota or fal (400 on bad input).
  const parsed = parseDepthInput(req.validatedBody)

  const aiUsage = req.scope.resolve(
    AI_USAGE_MODULE
  ) as unknown as AiUsageService

  // Soft-paywall: bounded free depth estimations per calendar month per
  // partner. Mirrors describe-image/segment — record BEFORE the expensive call
  // so it can't be raced; a failed fal call still consumes the slot (cheap
  // behaviour until real subscriptions add metering refunds).
  const quota = await aiUsage.checkQuota(partner.id, "image_depth")
  if (!quota.allowed) {
    res.status(402).json({
      upgrade_required: true,
      code: "ai_quota_exhausted",
      message:
        "You've used your free AI depth maps this month. Upgrade to keep going.",
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

  await aiUsage.recordUsage(partner.id, "image_depth", { designId })

  const { fal } = await import("@fal-ai/client")
  fal.config({ credentials: falKey })

  // Resolve the input image URL (upload base64 to fal storage first).
  let resolvedImageUrl: string
  if (parsed.kind === "url") {
    resolvedImageUrl = parsed.imageUrl
  } else {
    const buffer = Buffer.from(parsed.content, "base64")
    const blob = new Blob([buffer], { type: parsed.mimeType })
    const file = new File([blob], `depth-input.${parsed.extension}`, {
      type: parsed.mimeType,
    })
    resolvedImageUrl = await fal.storage.upload(file)
  }

  const result = await fal.subscribe("fal-ai/image-preprocessors/midas", {
    input: {
      image_url: resolvedImageUrl,
      a: 6.283185307179586,
      background_threshold: 0.1,
    } as any,
  })

  const depth = extractDepthOutput(result)

  res.status(200).json({
    depth,
    usage: { used: quota.used + 1, limit: quota.limit },
  })
}
