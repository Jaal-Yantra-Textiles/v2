import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { FAIRE_SYNC_MODULE } from "../../../../../modules/faire-sync"
import FaireSyncService from "../../../../../modules/faire-sync/service"
import { syncProductToFaireWorkflow } from "../../../../../workflows/sync-product-to-faire"
import { removeProductFromFaireWorkflow } from "../../../../../workflows/remove-product-from-faire"

// GET /admin/faire/syncs/:id — fetch a single sync record
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: FaireSyncService = req.scope.resolve(FAIRE_SYNC_MODULE)
  const { id } = req.params
  const [record] = await service.listFaireSyncRecords({ id } as any, { take: 1 } as any)
  if (!record) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Sync record not found")
  }
  res.json({ sync: record })
}

// POST /admin/faire/syncs/:id/retry — re-sync the product referenced by this record
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: FaireSyncService = req.scope.resolve(FAIRE_SYNC_MODULE)
  const { id } = req.params
  const [record] = await service.listFaireSyncRecords({ id } as any, { take: 1 } as any)
  if (!record) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Sync record not found")
  }

  const { result } = await syncProductToFaireWorkflow(req.scope).run({
    input: { product_id: (record as any).product_id },
  })

  res.json({ result })
}

// DELETE /admin/faire/syncs/:id — remove (unpublish) the Faire product for this
// record's product and clear the local link. Faire has no hard-delete API, so
// this sets the product back to DRAFT (hidden from buyers).
export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: FaireSyncService = req.scope.resolve(FAIRE_SYNC_MODULE)
  const { id } = req.params
  const [record] = await service.listFaireSyncRecords({ id } as any, { take: 1 } as any)
  if (!record) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Sync record not found")
  }

  const { result } = await removeProductFromFaireWorkflow(req.scope).run({
    input: { product_id: (record as any).product_id },
  })

  res.json({ result })
}
