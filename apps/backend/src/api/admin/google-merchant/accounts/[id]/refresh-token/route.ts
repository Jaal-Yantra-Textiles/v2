import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { GOOGLE_MERCHANT_MODULE } from "../../../../../../modules/google_merchant"
import type GoogleMerchantService from "../../../../../../modules/google_merchant/service"
import { sanitizeAccount } from "../../helpers"

/**
 * POST /admin/google-merchant/accounts/:id/refresh-token
 *
 * Forces an OAuth access-token refresh using the stored refresh_token. Useful
 * for admins to verify the refresh flow is actually working and to kick off a
 * refresh without waiting for a sync/import call to do it lazily.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service = req.scope.resolve(GOOGLE_MERCHANT_MODULE) as GoogleMerchantService

  try {
    await service.refreshAndStoreAccessToken(req.params.id, req.scope)
  } catch (err: any) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      err?.message || "Failed to refresh access token"
    )
  }

  const [updated] = await service.listGoogleMerchantAccounts(
    { id: req.params.id },
    { take: 1 }
  )
  if (!updated) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Account ${req.params.id} not found`)
  }

  res.status(200).json({ account: sanitizeAccount(updated) })
}
