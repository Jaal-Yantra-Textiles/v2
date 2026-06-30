import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ETSY_SYNC_MODULE } from "../../../../../modules/etsy-sync"
import EtsySyncService from "../../../../../modules/etsy-sync/service"

// GET /admin/etsy/auth/authorize — begins OAuth, returns the Etsy authorize URL
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: EtsySyncService = req.scope.resolve(ETSY_SYNC_MODULE)
  const { authorization_url, state } = await service.startOAuth()
  res.json({ authorization_url, state })
}
