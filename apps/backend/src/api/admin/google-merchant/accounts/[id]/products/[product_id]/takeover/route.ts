import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { takeoverProductFromGoogleWorkflow } from "../../../../../../../../workflows/google_merchant"

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { result } = await takeoverProductFromGoogleWorkflow(req.scope).run({
    input: {
      account_id: req.params.id,
      product_id: req.params.product_id,
    },
  })
  res.status(200).json(result)
}
