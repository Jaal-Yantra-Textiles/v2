import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ETSY_SYNC_MODULE } from "../../../../../modules/etsy-sync"
import EtsySyncService from "../../../../../modules/etsy-sync/service"

// POST /admin/etsy/auth/disconnect
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: EtsySyncService = req.scope.resolve(ETSY_SYNC_MODULE)
  await service.disconnect()
  res.json({ disconnected: true })
}
