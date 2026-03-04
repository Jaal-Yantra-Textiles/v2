import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { StoreTryOnReq } from "./validators"
import { tryOnGarmentWorkflow } from "../../../../workflows/ai/try-on-garment"

export const POST = async (
  req: AuthenticatedMedusaRequest<StoreTryOnReq>,
  res: MedusaResponse
) => {
  const customerId = req.auth_context?.actor_id

  if (!customerId) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Customer auth required")
  }

  const { garment_image_url, garment_image_base64, face_image_base64, cloth_type, gender, model_preset } =
    req.validatedBody

  if (!garment_image_url && !garment_image_base64) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Either garment_image_url or garment_image_base64 is required"
    )
  }

  const { result, errors } = await tryOnGarmentWorkflow(req.scope).run({
    input: {
      customer_id: customerId,
      garment_image_url,
      garment_image_base64,
      face_image_base64,
      cloth_type,
      gender,
      model_preset,
    },
  })

  if (errors.length) {
    throw errors[0]
  }

  return res.status(200).json({ tryon: result })
}
