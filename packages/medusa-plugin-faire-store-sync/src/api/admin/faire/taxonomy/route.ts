import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { FAIRE_SYNC_MODULE } from "../../../../modules/faire-sync"
import FaireSyncService from "../../../../modules/faire-sync/service"

// GET /admin/faire/taxonomy — taxonomy types from Faire's /products/types
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: FaireSyncService = req.scope.resolve(FAIRE_SYNC_MODULE)
  const types = await service.getTaxonomyTypes()
  res.json({ taxonomy: types })
}
