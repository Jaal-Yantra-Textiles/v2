import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { WebVerifyFormResponse } from "../validators"
import { verifyFormResponseWorkflow } from "../../../../../../../workflows/forms/verify-form-response"

export const POST = async (
  req: MedusaRequest<WebVerifyFormResponse>,
  res: MedusaResponse
) => {
  const { result } = await verifyFormResponseWorkflow(req.scope).run({
    input: {
      response_id: req.validatedBody.response_id,
      code: req.validatedBody.code,
    },
  })

  res.status(200).json({ response: result, verified: true })
}
