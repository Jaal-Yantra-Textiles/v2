import { MedusaContainer } from "@medusajs/framework/types"
import { ETSY_SYNC_MODULE } from "../modules/etsy-sync"
import EtsySyncService from "../modules/etsy-sync/service"

// Refreshes the Etsy access token before its 1-hour expiry (rotates refresh token).
export default async function refreshEtsyTokenJob(container: MedusaContainer) {
  const service: EtsySyncService = container.resolve(ETSY_SYNC_MODULE)
  const account = await service.getActiveAccount()
  if (!account) {
    return
  }
  try {
    await service.ensureFreshToken(account)
  } catch (err: any) {
    console.error("[etsy-sync] token refresh failed:", err.message)
  }
}

export const config = {
  name: "etsy-refresh-token",
  schedule: "*/10 * * * *",
}
