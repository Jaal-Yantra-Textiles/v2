import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { deleteFormWorkflow } from "../../../../workflows/forms/delete-form"
import { updateFormWorkflow } from "../../../../workflows/forms/update-form"
import { AdminUpdateForm } from "../validators"
import { refetchForm } from "../helpers"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const form = await refetchForm(req.params.id, req.scope)
  res.status(200).json({ form })
}

export const POST = async (
  req: MedusaRequest<AdminUpdateForm>,
  res: MedusaResponse
) => {
  const { result } = await updateFormWorkflow(req.scope).run({
    input: {
      id: req.params.id,
      ...req.validatedBody,
    },
  })

  const form = await refetchForm((result as any).id || req.params.id, req.scope)
  res.status(200).json({ form })
}

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  await deleteFormWorkflow(req.scope).run({
    input: { id: req.params.id },
  })

  res.status(200).json({
    id: req.params.id,
    object: "form",
    deleted: true,
  })
}
