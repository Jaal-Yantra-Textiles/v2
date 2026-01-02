import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { setFormFieldsWorkflow } from "../../../../../workflows/forms/set-form-fields"
import { refetchForm } from "../../helpers"
import { AdminSetFormFields } from "../../validators"

export const POST = async (
  req: MedusaRequest<AdminSetFormFields>,
  res: MedusaResponse
) => {
  const { result } = await setFormFieldsWorkflow(req.scope).run({
    input: {
      id: req.params.id,
      fields: req.validatedBody.fields,
    },
  })

  const form = await refetchForm((result as any).form_id || req.params.id, req.scope)
  res.status(200).json({ form })
}
