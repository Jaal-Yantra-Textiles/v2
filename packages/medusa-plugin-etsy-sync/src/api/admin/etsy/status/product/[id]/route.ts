import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ETSY_SYNC_MODULE } from "../../../../../../modules/etsy-sync"
import EtsySyncService from "../../../../../../modules/etsy-sync/service"

// GET /admin/etsy/status/product/:id — latest sync state for a single product.
// Lets the product widget rehydrate after navigation instead of losing state.
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params
  const service: EtsySyncService = req.scope.resolve(ETSY_SYNC_MODULE)

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
          listing_id: latest.listing_id,
          listing_url: latest.listing_url,
          listing_state: latest.listing_state,
          published: latest.published,
          error_message: latest.error_message,
          synced_at: latest.synced_at,
        }
      : null,
  })
}
