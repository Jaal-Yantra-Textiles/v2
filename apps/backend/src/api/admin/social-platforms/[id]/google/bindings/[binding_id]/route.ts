import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { deleteGoogleBindingWorkflow } from "../../../../../../../workflows/google/delete-binding"
import { updateGoogleBindingWorkflow } from "../../../../../../../workflows/google/update-binding"

type UpdateBody = {
  resource_label?: string | null
  settings?: Record<string, any> | null
  metadata?: Record<string, any> | null
  status?: "active" | "paused" | "error" | "pending"
}

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const { result } = await deleteGoogleBindingWorkflow(req.scope).run({
    input: {
      platform_id: req.params.id,
      binding_id: req.params.binding_id,
    },
  })

  res.status(200).json(result)
}

export const POST = async (req: MedusaRequest<UpdateBody>, res: MedusaResponse) => {
  const body = (req.body || {}) as UpdateBody

  const { result } = await updateGoogleBindingWorkflow(req.scope).run({
    input: {
      platform_id: req.params.id,
      binding_id: req.params.binding_id,
      resource_label: body.resource_label,
      settings: body.settings,
      metadata: body.metadata,
      status: body.status,
    },
  })

  res.status(200).json({ binding: result })
}
