import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { FAIRE_SYNC_MODULE } from "../../../../../../modules/faire-sync"
import FaireSyncService from "../../../../../../modules/faire-sync/service"

// GET /admin/faire/sync/bulk/:batchId — poll the progress of a background batch
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { batchId } = req.params
  const service: FaireSyncService = req.scope.resolve(FAIRE_SYNC_MODULE)

  const batch = await service
    .retrieveFaireSyncBatch(batchId)
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
      finished:
        (batch as any).status === "completed" || (batch as any).status === "failed",
    },
  })
}
