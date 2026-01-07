import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { StoreGenerateAiImageReq } from "./validators"
import { generateDesignAiImageWorkflow } from "../../../../workflows/ai/generate-design-image"

export const POST = async (
  req: AuthenticatedMedusaRequest<StoreGenerateAiImageReq>,
  res: MedusaResponse
) => {
  const customerId = req.auth_context?.actor_id

  if (!customerId) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Customer auth required")
  }

  const { result, errors } = await generateDesignAiImageWorkflow(req.scope).run({
    input: {
      customer_id: customerId,
      ...req.validatedBody,
    },
  })

  if (errors.length) {
    throw errors[0]
  }

  return res.status(200).json({ generation: result })
}
