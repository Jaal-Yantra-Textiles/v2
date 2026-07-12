import { MedusaContainer } from "@medusajs/framework/types"
import { FAIRE_SYNC_MODULE } from "../modules/faire-sync"
import FaireSyncService from "../modules/faire-sync/service"

// Refreshes the Faire access token if it is set to expire (Faire tokens
// historically do not expire, but this keeps the OAuth2 path correct if yours do).
export default async function refreshFaireTokenJob(container: MedusaContainer) {
  const service: FaireSyncService = container.resolve(FAIRE_SYNC_MODULE)
  const account = await service.getActiveAccount()
  if (!account) {
    return
  }
  // API-key connections have no OAuth token to refresh — skip entirely so the
  // cron never drives Faire's token endpoint (which 400s for non-OAuth creds).
  if ((account as any).auth_mode === "apiKey") {
    return
  }
  try {
    await service.ensureFreshToken(account)
  } catch (err: any) {
    console.error("[faire-sync] token refresh failed:", err.message)
  }
}

export const config = {
  name: "faire-refresh-token",
  schedule: "*/10 * * * *",
}
