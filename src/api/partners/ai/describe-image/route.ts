import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../../helpers"
import { describeProductImageWorkflow } from "../../../../workflows/ai/describe-product-image"
import { AI_USAGE_MODULE } from "../../../../modules/ai_usage"
import type AiUsageService from "../../../../modules/ai_usage/service"

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "Partner authentication required"
    )
  }

  const body = (req.body ?? {}) as { imageUrl?: string; hint?: string }
  if (!body.imageUrl || typeof body.imageUrl !== "string") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "imageUrl is required"
    )
  }

  const aiUsage = req.scope.resolve(AI_USAGE_MODULE) as unknown as AiUsageService

  // Soft-paywall: 10 describes per calendar month per partner. We record
  // the attempt BEFORE calling the expensive vision API so a partner can't
  // race the check — even if the model call later fails, the slot is taken.
  // This is the cheap behavior; when we add real subscriptions we refund
  // failed attempts through a metering adjustment.
  const quota = await aiUsage.checkQuota(partner.id, "image_describe")
  if (!quota.allowed) {
    res.status(402).json({
      upgrade_required: true,
      code: "ai_quota_exhausted",
      message:
        "You've used your 10 free AI descriptions this month. Upgrade to keep going.",
      used: quota.used,
      limit: quota.limit,
    })
    return
  }

  await aiUsage.recordUsage(partner.id, "image_describe", {
    imageUrl: body.imageUrl,
  })

  const { result } = await describeProductImageWorkflow(req.scope).run({
    input: {
      imageUrl: body.imageUrl,
      hint: body.hint,
    },
  })

  res.json({
    title: (result as any).title,
    description: (result as any).description,
    usage: { used: quota.used + 1, limit: quota.limit },
  })
}
