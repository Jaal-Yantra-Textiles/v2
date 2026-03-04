import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { tryOnGarmentWorkflow } from "../../../../workflows/ai/try-on-garment"

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const customerId = req.auth_context?.actor_id

  if (!customerId) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Customer auth required")
  }

  const files = req.files as Record<string, Express.Multer.File[]> | undefined
  const garmentFile = files?.garment_image?.[0]
  const faceFile = files?.face_image?.[0]

  if (!garmentFile) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "garment_image file is required")
  }
  if (!faceFile) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "face_image file is required")
  }

  const { cloth_type, gender, model_preset } = req.body as {
    cloth_type?: string
    gender?: string
    model_preset?: string
  }

  // Convert multer buffers to base64 data URLs for the workflow (which uploads them to fal.ai)
  const garmentBase64 = `data:${garmentFile.mimetype};base64,${garmentFile.buffer.toString("base64")}`
  const faceBase64 = `data:${faceFile.mimetype};base64,${faceFile.buffer.toString("base64")}`

  const { result, errors } = await tryOnGarmentWorkflow(req.scope).run({
    input: {
      customer_id: customerId,
      garment_image_base64: garmentBase64,
      face_image_base64: faceBase64,
      cloth_type: (cloth_type as any) ?? "upper_body",
      gender: (gender as any) ?? "female",
      model_preset,
    },
  })

  if (errors.length) {
    throw errors[0]
  }

  return res.status(200).json({ tryon: result })
}
