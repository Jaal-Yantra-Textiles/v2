import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { unsyncProductFromGoogleWorkflow } from "../../../../../../../workflows/google_merchant"

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const { result } = await unsyncProductFromGoogleWorkflow(req.scope).run({
    input: {
      account_id: req.params.id,
      product_id: req.params.product_id,
    },
  })
  res.status(200).json(result)
}
