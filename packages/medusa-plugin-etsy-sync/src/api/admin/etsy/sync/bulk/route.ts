import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { syncProductsToEtsyWorkflow } from "../../../../../workflows/sync-products-to-etsy"

type BulkSyncBody = {
  product_ids?: string[]
}

// POST /admin/etsy/sync/bulk — sync many products (optionally filtered)
export const POST = async (req: MedusaRequest<BulkSyncBody>, res: MedusaResponse) => {
  const { product_ids } = req.body || {}

  if (!product_ids?.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "product_ids array is required"
    )
  }

  const { result } = await syncProductsToEtsyWorkflow(req.scope).run({
    input: { product_ids },
  })

  res.json({ result })
}
