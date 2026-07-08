import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { FAIRE_SYNC_MODULE } from "../../../../modules/faire-sync"
import FaireSyncService from "../../../../modules/faire-sync/service"

// GET /admin/faire/brand — the connected Faire brand (fresh token)
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: FaireSyncService = req.scope.resolve(FAIRE_SYNC_MODULE)
  const account = await service.ensureFreshToken()
  const client = service.getClient()
  const brand = await client.getBrand(account.access_token)
  res.json({ brand })
}
