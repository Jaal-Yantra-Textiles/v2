import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { GOOGLE_MERCHANT_MODULE } from "../../../../../modules/google_merchant"
import type GoogleMerchantService from "../../../../../modules/google_merchant/service"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service = req.scope.resolve(GOOGLE_MERCHANT_MODULE) as GoogleMerchantService
  const [job] = await service.listGoogleMerchantSyncJobs({ id: req.params.id }, { take: 1 })
  if (!job) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Sync job ${req.params.id} not found`)
  }
  res.status(200).json({ job })
}
