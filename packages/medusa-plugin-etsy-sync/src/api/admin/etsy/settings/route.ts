import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ETSY_SYNC_MODULE } from "../../../../modules/etsy-sync"
import EtsySyncService from "../../../../modules/etsy-sync/service"

// GET /admin/etsy/settings
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: EtsySyncService = req.scope.resolve(ETSY_SYNC_MODULE)
  const settings = await service.getSettings()
  res.json({ settings })
}

// POST /admin/etsy/settings
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: EtsySyncService = req.scope.resolve(ETSY_SYNC_MODULE)
  const settings = await service.updateSettings(req.body || {})
  res.json({ settings })
}
