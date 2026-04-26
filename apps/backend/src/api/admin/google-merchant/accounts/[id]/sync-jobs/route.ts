import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { GOOGLE_MERCHANT_MODULE } from "../../../../../../modules/google_merchant"
import type GoogleMerchantService from "../../../../../../modules/google_merchant/service"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service = req.scope.resolve(GOOGLE_MERCHANT_MODULE) as GoogleMerchantService
  const accountId = req.params.id
  const limit = Math.min(parseInt((req.query.limit as string) || "20", 10), 100)
  const offset = parseInt((req.query.offset as string) || "0", 10)

  const [jobs, count] = await service.listAndCountGoogleMerchantSyncJobs(
    { account_id: accountId },
    { take: limit, skip: offset, order: { started_at: "DESC", id: "DESC" } as any }
  )

  res.status(200).json({ jobs, count, limit, offset })
}
