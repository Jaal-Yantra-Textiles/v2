import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../../helpers"
import { AI_USAGE_MODULE } from "../../../../modules/ai_usage"
import type AiUsageService from "../../../../modules/ai_usage/service"

/**
 * GET /partners/ai/usage
 *
 * Returns the partner's current-month counters for each tracked operation.
 * The UI uses this to show "X/10 used this month" before calling a paid
 * endpoint.
 */
export const GET = async (
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

  const aiUsage = req.scope.resolve(AI_USAGE_MODULE) as unknown as AiUsageService
  const imageDescribe = await aiUsage.checkQuota(
    partner.id,
    "image_describe"
  )

  res.json({
    image_describe: imageDescribe,
  })
}
