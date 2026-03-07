import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { StoreTryOnReq } from "./validators"
import { tryOnGarmentWorkflow } from "../../../../workflows/ai/try-on-garment"

// Magic-byte signatures for allowed image formats.
// We verify these on any base64 content so a malicious client cannot
// sneak arbitrary data through by encoding it as a fake image data URL.
const IMAGE_SIGNATURES: Array<{ mime: string; bytes: number[]; offset?: number }> = [
  { mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { mime: "image/png",  bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: "image/webp", bytes: [0x52, 0x49, 0x46, 0x46], offset: 0 }, // "RIFF"
]

function detectImageMime(buf: Buffer): string | null {
  for (const sig of IMAGE_SIGNATURES) {
    const off = sig.offset ?? 0
    if (buf.length < off + sig.bytes.length) continue
    const matches = sig.bytes.every((b, i) => buf[off + i] === b)
    if (!matches) continue
    if (sig.mime === "image/webp") {
      if (buf.length < 12) continue
      if (buf.toString("ascii", 8, 12) !== "WEBP") continue
    }
    return sig.mime
  }
  return null
}

function validateBase64Image(dataUrl: string, fieldName: string): void {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
  if (!match) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `${fieldName} must be a valid base64 data URL`
    )
  }
  const buf = Buffer.from(match[2], "base64")
  if (!detectImageMime(buf)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `${fieldName} must contain a valid JPEG, PNG or WebP image`
    )
  }
}

export const POST = async (
  req: AuthenticatedMedusaRequest<StoreTryOnReq>,
  res: MedusaResponse
) => {
  const customerId = req.auth_context?.actor_id

  if (!customerId) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Customer auth required")
  }

  const customerService = req.scope.resolve(Modules.CUSTOMER) as any
  const [customer] = await customerService.listCustomers({ id: [customerId] })
  if (!customer?.metadata?.ai_features_paid) {
    return res.status(402).json({
      error: {
        code: "PAYMENT_REQUIRED",
        message: "AI features require a one-time €2 verification fee",
      },
    })
  }

  const { garment_image_url, garment_image_base64, face_image_base64, cloth_type, gender, model_preset } =
    req.validatedBody

  if (!garment_image_url && !garment_image_base64) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Either garment_image_url or garment_image_base64 is required"
    )
  }

  // Validate magic bytes for any base64 inputs to prevent content smuggling
  if (garment_image_base64) {
    validateBase64Image(garment_image_base64, "garment_image_base64")
  }
  if (face_image_base64) {
    validateBase64Image(face_image_base64, "face_image_base64")
  }

  const { result, errors } = await tryOnGarmentWorkflow(req.scope).run({
    input: {
      customer_id: customerId,
      garment_image_url,
      garment_image_base64,
      face_image_base64,
      cloth_type,
      gender,
    },
  })

  if (errors.length) {
    throw errors[0]
  }

  return res.status(200).json({ tryon: result })
}
