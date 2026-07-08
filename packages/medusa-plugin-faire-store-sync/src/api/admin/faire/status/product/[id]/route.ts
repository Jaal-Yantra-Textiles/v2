import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { FAIRE_SYNC_MODULE } from "../../../../../../modules/faire-sync"
import FaireSyncService from "../../../../../../modules/faire-sync/service"

// GET /admin/faire/status/product/:id — latest sync state for a single product.
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params
  const service: FaireSyncService = req.scope.resolve(FAIRE_SYNC_MODULE)

  const connected = !!(await service.getActiveAccount())
  const [records] = await service.listSyncRecords({ product_id: id }, 1, 0)
  const latest: any = records?.[0] ?? null

  res.json({
    connected,
    synced: !!latest,
    latest: latest
      ? {
          id: latest.id,
          status: latest.status,
          product_token: latest.product_token,
          product_url: latest.product_url,
          product_state: latest.product_state,
          published: latest.published,
          error_message: latest.error_message,
          synced_at: latest.synced_at,
        }
      : null,
  })
}
