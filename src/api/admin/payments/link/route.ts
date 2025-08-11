import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { createPaymentAndLinkWorkflow } from "../../../../workflows/internal_payments/create-payment-and-link"
import { CreatePaymentAndLink } from "./validators"

export const POST = async (req: MedusaRequest<CreatePaymentAndLink>, res: MedusaResponse) => {
  const { result } = await createPaymentAndLinkWorkflow(req.scope).run({
    input: req.validatedBody,
  })

  return res.status(201).json(result)
}
