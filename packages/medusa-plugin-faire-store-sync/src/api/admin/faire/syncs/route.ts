import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { FAIRE_SYNC_MODULE } from "../../../../modules/faire-sync"
import FaireSyncService from "../../../../modules/faire-sync/service"

// GET /admin/faire/syncs — list recent sync records (paginated)
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: FaireSyncService = req.scope.resolve(FAIRE_SYNC_MODULE)
  const take = Number(req.query.take) || 20
  const skip = Number(req.query.skip) || 0
  const status = req.query.status as string | undefined

  const filters: any = {}
  if (status) filters.status = status

  const [records, count] = await service.listSyncRecords(filters, take, skip)
  res.json({ syncs: records, count, take, skip })
}
