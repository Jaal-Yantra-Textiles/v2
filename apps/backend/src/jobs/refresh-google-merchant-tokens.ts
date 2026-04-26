import { MedusaContainer } from "@medusajs/framework/types"

import { GOOGLE_MERCHANT_MODULE } from "../modules/google_merchant"
import type GoogleMerchantService from "../modules/google_merchant/service"

// Google Merchant access tokens live ~1 hour. The service's lazy path refreshes
// 60 seconds before expiry, but lazy-refresh adds latency to the first call
// after expiry. This job runs proactively so live traffic always sees a fresh
// token — and, just as importantly, it produces a visible token_refreshed_at
// timestamp so admins can tell the refresh flow is actually running.
const REFRESH_BUFFER_MS = 15 * 60 * 1000 // refresh if expiring within 15 min

export default async function refreshGoogleMerchantTokensJob(
  container: MedusaContainer
) {
  const logger = container.resolve("logger")
  const service = container.resolve(GOOGLE_MERCHANT_MODULE) as GoogleMerchantService

  const accounts = await service.listGoogleMerchantAccounts({}, { take: 500 })

  const now = Date.now()
  const due = accounts.filter((a: any) => {
    if (!a?.refresh_token) return false
    // No expiry recorded — refresh once so we capture the new timestamps.
    if (!a.token_expires_at) return true
    const expiresAt = new Date(a.token_expires_at).getTime()
    return expiresAt - now < REFRESH_BUFFER_MS
  })

  if (due.length === 0) {
    logger.info("[google-merchant-refresh] No accounts need refreshing")
    return
  }

  logger.info(
    `[google-merchant-refresh] Refreshing ${due.length} of ${accounts.length} accounts`
  )

  let succeeded = 0
  let failed = 0
  for (const account of due) {
    try {
      await service.refreshAndStoreAccessToken(account.id, container)
      succeeded++
    } catch (err: any) {
      failed++
      logger.error(
        `[google-merchant-refresh] Failed to refresh account ${account.id} (${account.name}): ${err?.message || err}`
      )
    }
  }

  logger.info(
    `[google-merchant-refresh] Done — ${succeeded} refreshed, ${failed} failed`
  )
}

export const config = {
  name: "refresh-google-merchant-tokens",
  // Run every 30 minutes. Tokens are valid for ~1h, so this + the 15-minute
  // buffer gives us two refresh attempts per token lifetime.
  schedule: "*/30 * * * *",
}
