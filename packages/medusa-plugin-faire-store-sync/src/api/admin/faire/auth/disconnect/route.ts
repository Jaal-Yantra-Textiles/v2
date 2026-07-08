import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { FAIRE_SYNC_MODULE } from "../../../../../modules/faire-sync"
import FaireSyncService from "../../../../../modules/faire-sync/service"

// POST /admin/faire/auth/disconnect
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: FaireSyncService = req.scope.resolve(FAIRE_SYNC_MODULE)
  await service.disconnect()
  res.json({ disconnected: true })
}
