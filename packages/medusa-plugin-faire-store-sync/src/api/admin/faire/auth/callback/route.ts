import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { FAIRE_SYNC_MODULE } from "../../../../../modules/faire-sync"
import FaireSyncService from "../../../../../modules/faire-sync/service"

// POST /admin/faire/auth/callback — exchanges the OAuth code (called by the
// admin SPA callback page, so it runs with an authenticated admin session).
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { code, state } = req.body as { code: string; state: string }

  if (!code || !state) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "code and state are required"
    )
  }

  const service: FaireSyncService = req.scope.resolve(FAIRE_SYNC_MODULE)
  const { account, brand } = await service.completeOAuth(code, state)

  res.json({
    account: {
      id: (account as any).id,
      brand_id: (account as any).brand_id,
      brand_name: (account as any).brand_name,
    },
    brand,
  })
}
