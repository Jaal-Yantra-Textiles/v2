import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { tryOnGarmentWorkflow } from "../../../../workflows/ai/try-on-garment"

// Magic-byte signatures for allowed image formats.
// We verify these independently of the client-supplied Content-Type so a
// malicious upload cannot smuggle arbitrary content by faking its MIME type.
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
    // WebP also requires "WEBP" at bytes 8–11
    if (sig.mime === "image/webp") {
      if (buf.length < 12) continue
      if (buf.toString("ascii", 8, 12) !== "WEBP") continue
    }
    return sig.mime
  }
  return null
}

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

  // Validate actual file content via magic bytes — the client-supplied
  // Content-Type is untrusted and must not be forwarded as-is.
  const garmentMime = detectImageMime(garmentFile.buffer)
  if (!garmentMime) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "garment_image must be a valid JPEG, PNG or WebP image")
  }
  const faceMime = detectImageMime(faceFile.buffer)
  if (!faceMime) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "face_image must be a valid JPEG, PNG or WebP image")
  }

  const { cloth_type, gender, model_preset } = req.body as {
    cloth_type?: string
    gender?: string
    model_preset?: string
  }

  // Use the server-detected MIME type, not the client-supplied one
  const garmentBase64 = `data:${garmentMime};base64,${garmentFile.buffer.toString("base64")}`
  const faceBase64 = `data:${faceMime};base64,${faceFile.buffer.toString("base64")}`

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
