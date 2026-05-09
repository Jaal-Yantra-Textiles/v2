import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { deleteGoogleBindingWorkflow } from "../../../../../../../workflows/google/delete-binding"

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const { result } = await deleteGoogleBindingWorkflow(req.scope).run({
    input: {
      platform_id: req.params.id,
      binding_id: req.params.binding_id,
    },
  })

  res.status(200).json(result)
}
