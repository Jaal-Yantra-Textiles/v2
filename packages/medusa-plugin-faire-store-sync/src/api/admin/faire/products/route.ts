import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { FAIRE_SYNC_MODULE } from "../../../../modules/faire-sync"
import FaireSyncService from "../../../../modules/faire-sync/service"

// GET /admin/faire/products — list products already on Faire (cursor-paginated).
// `page` is an opaque cursor returned by the previous response's `next_page`,
// NOT a 1-based index. Optional `updated_at_min` filters to changed products.
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: FaireSyncService = req.scope.resolve(FAIRE_SYNC_MODULE)
  const account = await service.ensureFreshToken()
  const client = service.getClient()
  const limit = Number(req.query.limit) || 50
  const page = typeof req.query.page === "string" ? req.query.page : undefined
  const updated_at_min =
    typeof req.query.updated_at_min === "string"
      ? req.query.updated_at_min
      : undefined
  const data = await client.listProducts(account.access_token, {
    limit,
    page,
    updated_at_min,
  })
  res.json({
    products: data.results,
    count: data.count,
    next_page: data.next_page,
  })
}
