import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { EMAIL_PROVIDER_MANAGER_MODULE } from "../../../modules/email-provider-manager"
import EmailProviderManagerService from "../../../modules/email-provider-manager/service"

/**
 * GET /admin/email-providers
 * Returns the current email provider capacity and daily usage.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const providerManager: EmailProviderManagerService = req.scope.resolve(
    EMAIL_PROVIDER_MANAGER_MODULE
  )

  const capacities = await providerManager.getRemainingCapacity()
  const totalRemaining = capacities.reduce((sum, c) => sum + c.remaining, 0)
  const totalLimit = capacities.reduce((sum, c) => sum + c.limit, 0)

  res.json({
    providers: capacities,
    total_remaining: totalRemaining,
    total_daily_limit: totalLimit,
  })
}
