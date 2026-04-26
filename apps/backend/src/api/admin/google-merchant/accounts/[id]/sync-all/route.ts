import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { GOOGLE_MERCHANT_MODULE } from "../../../../../../modules/google_merchant"
import type GoogleMerchantService from "../../../../../../modules/google_merchant/service"
import { bulkSyncProductsToGoogleWorkflow } from "../../../../../../workflows/google_merchant"

type Body = {
  product_ids?: string[]
  content_language?: string
  feed_label?: string
  currency_code?: string
  landing_url_base?: string
}

export const POST = async (req: MedusaRequest<Body>, res: MedusaResponse) => {
  const accountId = req.params.id
  const service = req.scope.resolve(GOOGLE_MERCHANT_MODULE) as GoogleMerchantService
  const logger = req.scope.resolve("logger") as any

  const [account] = await service.listGoogleMerchantAccounts({ id: accountId }, { take: 1 })
  if (!account) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Account ${accountId} not found`)
  }
  if (!account.refresh_token) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Account not authenticated — complete OAuth first")
  }

  const job = await service.createGoogleMerchantSyncJobs({
    account_id: accountId,
    status: "pending",
    total_products: 0,
    synced_count: 0,
    failed_count: 0,
  })

  // Fire-and-forget: bulk sync runs async; client polls GET /sync-jobs/:id for progress.
  bulkSyncProductsToGoogleWorkflow(req.scope)
    .run({
      input: {
        job_id: job.id,
        account_id: accountId,
        product_ids: req.body?.product_ids,
        content_language: req.body?.content_language,
        feed_label: req.body?.feed_label,
        currency_code: req.body?.currency_code,
        landing_url_base: req.body?.landing_url_base,
      },
    })
    .catch((e: any) => {
      logger?.error?.(`[sync-all] workflow failed for job ${job.id}: ${e.message}`)
    })

  res.status(202).json({ job })
}
