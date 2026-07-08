import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { syncProductToFaireWorkflow } from "../../../../../../workflows/sync-product-to-faire"

// POST /admin/faire/sync/product/:id — sync a single product to Faire
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params

  const { result } = await syncProductToFaireWorkflow(req.scope).run({
    input: { product_id: id },
  })

  res.json({ result })
}
