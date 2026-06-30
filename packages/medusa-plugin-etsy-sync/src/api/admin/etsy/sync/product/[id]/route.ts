import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { syncProductToEtsyWorkflow } from "../../../../../../workflows/sync-product-to-etsy"

// POST /admin/etsy/sync/product/:id — sync a single product to Etsy
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params

  const { result } = await syncProductToEtsyWorkflow(req.scope).run({
    input: { product_id: id },
  })

  res.json({ result })
}
