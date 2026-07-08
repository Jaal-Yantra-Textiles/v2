import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { FAIRE_SYNC_MODULE } from "../../../../modules/faire-sync"
import FaireSyncService from "../../../../modules/faire-sync/service"

// GET /admin/faire/products — list products already on Faire (paginated)
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: FaireSyncService = req.scope.resolve(FAIRE_SYNC_MODULE)
  const account = await service.ensureFreshToken()
  const client = service.getClient()
  const limit = Number(req.query.limit) || 50
  const page = req.query.page ? Number(req.query.page) : 1
  const data = await client.listProducts(account.access_token, { limit, page })
  res.json({ products: data.results, count: data.count })
}
