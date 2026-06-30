import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ETSY_SYNC_MODULE } from "../../../../modules/etsy-sync"
import EtsySyncService from "../../../../modules/etsy-sync/service"

// GET /admin/etsy/syncs — list recent sync records (paginated)
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: EtsySyncService = req.scope.resolve(ETSY_SYNC_MODULE)
  const take = Number(req.query.take) || 20
  const skip = Number(req.query.skip) || 0
  const status = req.query.status as string | undefined

  const filters: any = {}
  if (status) filters.status = status

  const [records, count] = await service.listSyncRecords(filters, take, skip)
  res.json({ syncs: records, count, take, skip })
}
