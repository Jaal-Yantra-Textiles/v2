import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { GOOGLE_MERCHANT_MODULE } from "../../../../../../modules/google_merchant"
import type GoogleMerchantService from "../../../../../../modules/google_merchant/service"

type RegisterBody = {
  developer_email?: string
}

/**
 * POST /admin/google-merchant/accounts/:id/register-developer
 *
 * Calls Merchant API `developerRegistration:registerGcp` to link the GCP
 * project that holds this account's OAuth client to the Merchant Center
 * account. One-time per GCP project — but safe to call again (Google returns
 * the existing registration record).
 *
 * Required when read endpoints (products.list) return:
 *   "GCP project ... is not registered with the merchant account"
 */
export const POST = async (
  req: MedusaRequest<RegisterBody>,
  res: MedusaResponse
) => {
  const service = req.scope.resolve(GOOGLE_MERCHANT_MODULE) as GoogleMerchantService
  const body = (req.body || {}) as RegisterBody

  try {
    const result = await service.registerDeveloperWithMerchant(
      req.params.id,
      req.scope,
      body.developer_email
    )
    res.status(200).json({ registration: result })
  } catch (err: any) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      err?.message || "Failed to register GCP project with Merchant Center"
    )
  }
}
