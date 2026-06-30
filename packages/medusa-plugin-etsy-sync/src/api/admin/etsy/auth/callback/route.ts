import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { ETSY_SYNC_MODULE } from "../../../../../modules/etsy-sync"
import EtsySyncService from "../../../../../modules/etsy-sync/service"

// POST /admin/etsy/auth/callback — exchanges the OAuth code (called by the
// admin SPA callback page, so it runs with an authenticated admin session).
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { code, state } = req.body as { code: string; state: string }

  if (!code || !state) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "code and state are required"
    )
  }

  const service: EtsySyncService = req.scope.resolve(ETSY_SYNC_MODULE)
  const { account, shop } = await service.completeOAuth(code, state)

  res.json({
    account: {
      id: (account as any).id,
      shop_id: (account as any).shop_id,
      shop_name: (account as any).shop_name,
    },
    shop,
  })
}
