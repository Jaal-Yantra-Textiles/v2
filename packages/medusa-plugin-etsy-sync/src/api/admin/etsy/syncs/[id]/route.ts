import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { ETSY_SYNC_MODULE } from "../../../../../modules/etsy-sync"
import EtsySyncService from "../../../../../modules/etsy-sync/service"
import { syncProductToEtsyWorkflow } from "../../../../../workflows/sync-product-to-etsy"
import { deleteListingFromEtsyWorkflow } from "../../../../../workflows/delete-listing-from-etsy"

// GET /admin/etsy/syncs/:id — fetch a single sync record
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: EtsySyncService = req.scope.resolve(ETSY_SYNC_MODULE)
  const { id } = req.params
  const [record] = await service.listEtsySyncRecords({ id } as any, { take: 1 } as any)
  if (!record) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Sync record not found")
  }
  res.json({ sync: record })
}

// POST /admin/etsy/syncs/:id/retry — re-sync the product referenced by this record
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: EtsySyncService = req.scope.resolve(ETSY_SYNC_MODULE)
  const { id } = req.params
  const [record] = await service.listEtsySyncRecords({ id } as any, { take: 1 } as any)
  if (!record) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Sync record not found")
  }

  const { result } = await syncProductToEtsyWorkflow(req.scope).run({
    input: { product_id: (record as any).product_id },
  })

  res.json({ result })
}

// DELETE /admin/etsy/syncs/:id — remove the Etsy listing for this record's
// product and clear the local link. Idempotent: a listing already gone on Etsy
// still cleans up our side.
export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: EtsySyncService = req.scope.resolve(ETSY_SYNC_MODULE)
  const { id } = req.params
  const [record] = await service.listEtsySyncRecords({ id } as any, { take: 1 } as any)
  if (!record) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Sync record not found")
  }

  const { result } = await deleteListingFromEtsyWorkflow(req.scope).run({
    input: { product_id: (record as any).product_id },
  })

  res.json({ result })
}
