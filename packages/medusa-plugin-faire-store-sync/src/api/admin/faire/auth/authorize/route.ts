import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { FAIRE_SYNC_MODULE } from "../../../../../modules/faire-sync"
import FaireSyncService from "../../../../../modules/faire-sync/service"

// GET /admin/faire/auth/authorize — begins OAuth, returns the Faire authorize URL
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: FaireSyncService = req.scope.resolve(FAIRE_SYNC_MODULE)
  const { authorization_url, state } = await service.startOAuth()
  res.json({ authorization_url, state })
}
