import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { ETSY_SYNC_MODULE } from "../../../../../../modules/etsy-sync"
import EtsySyncService from "../../../../../../modules/etsy-sync/service"

// GET /admin/etsy/sync/bulk/:batchId — poll the progress of a background batch
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { batchId } = req.params
  const service: EtsySyncService = req.scope.resolve(ETSY_SYNC_MODULE)

  const batch = await service
    .retrieveEtsySyncBatch(batchId)
    .catch(() => null)

  if (!batch) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Batch not found")
  }

  const total = (batch as any).total_products || 0
  const done =
    ((batch as any).synced_count || 0) + ((batch as any).failed_count || 0)

  res.json({
    batch,
    progress: {
      total,
      done,
      pct: total ? Math.round((done / total) * 100) : 0,
      finished: (batch as any).status === "completed" || (batch as any).status === "failed",
    },
  })
}
