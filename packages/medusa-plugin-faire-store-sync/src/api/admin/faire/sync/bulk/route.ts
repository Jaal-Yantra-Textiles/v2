import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { syncProductsToFaireWorkflow } from "../../../../../workflows/sync-products-to-faire"

type BulkSyncBody = {
  product_ids?: string[]
}

// POST /admin/faire/sync/bulk — sync many products (long-running background workflow)
export const POST = async (req: MedusaRequest<BulkSyncBody>, res: MedusaResponse) => {
  const { product_ids } = req.body || {}

  if (!product_ids?.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "product_ids array is required"
    )
  }

  const { result } = await syncProductsToFaireWorkflow(req.scope).run({
    input: { product_ids },
  })

  // The workflow runs the per-product sync in the background; we return the
  // batch id immediately so the client can poll GET /admin/faire/sync/bulk/:id.
  res.status(202).json({ batch_id: (result as any).batch_id, status: "processing" })
}
