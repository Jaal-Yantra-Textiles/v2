
/**
 * Initiate multipart upload (S3 / provider-backed)
 *
 * POST handler that starts a multipart upload for a file and returns upload
 * metadata (uploadId, key, bucket, region and partSize) required by the
 * client to upload parts.
 *
 * Request body (JSON):
 * - name: string — original filename (required)
 * - type: string — MIME/content type (required)
 * - size: number — file size in bytes (required)
 * - access?: "public" | "private" — whether the object should be public (default: "public")
 * - existingAlbumIds?: string[] — optional album ids to attach (echoed in response)
 * - folderPath?: string — optional folder path (accepted but not used by core implementation)
 *
 * Behavior:
 * - Validates that name, type and a finite numeric size are present; missing/invalid values
 *   result in a 400 response (MedusaError.Types.INVALID_DATA).
 * - Computes a flat object key placed at the bucket root by combining a "safe" base name
 *   (original filename with non-alphanumeric characters replaced by "_"), a random 8-byte
 *   hex suffix and the original extension (if any). Example: "<safeBase>-<rand>.<ext>".
 * - If a configured file provider exposes initiateMultipartUpload, delegates to it and
 *   returns the provider's upload id/key/bucket/region/part_size when provided.
 * - Otherwise falls back to the AWS SDK CreateMultipartUpload API:
 *   - Uses the requested content type.
 *   - Sets ACL to "public-read" when access === "public".
 * - Default part size returned is 8 * 1024 * 1024 (8MB) unless overridden by a provider.
 *
 * Success response (200 JSON):
 * {
 *   uploadId: string,
 *   key: string,
 *   bucket?: string,
 *   region?: string,
 *   partSize: number,
 *   existingAlbumIds: string[]
 * }
 *
 * Error handling:
 * - Validation errors return 400 with a message.
 * - Provider failures or unexpected states throw a MedusaError mapped to 500.
 * - Other unexpected errors return 500 with a generic message.
 *
 * Notes:
 * - The handler reads validated input from req.validatedBody when present, falling back
 *   to req.body for compatibility with middleware that does not attach validatedBody.
 * - Clients should use the returned uploadId and partSize to request presigned part URLs
 *   and upload parts, then call the multipart complete endpoint to finish the upload.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { CreateMultipartUploadCommand } from "@aws-sdk/client-s3"
import crypto from "crypto"
import { getS3Client } from "../s3"

interface InitiateBody {
  name: string
  type: string
  size: number
  access?: "public" | "private"
  existingAlbumIds?: string[]
  folderPath?: string
}

export const POST = async (req: MedusaRequest<InitiateBody>, res: MedusaResponse) => {
  try {
    const body = (req as any).validatedBody || (req.body as any)
    const name = body?.name as string
    const type = body?.type as string
    const size = Number(body?.size)
    const access = (body?.access as "public" | "private") || "public"

    if (!name || !type || !Number.isFinite(size)) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Missing required fields: name, type, size")
    }

    // Prefer provider if it supports multipart init
    const fileService: any = req.scope.resolve(Modules.FILE)
    const provider = fileService?.getProvider ? await fileService.getProvider() : null

    // Generate a flat filename at bucket root: <safeBase>-<rand>.<ext>
    // This mirrors the partner initiate behavior and yields clean public URLs
    const rand = crypto.randomBytes(8).toString("hex")
    const dot = name.lastIndexOf(".")
    const base = dot > 0 ? name.substring(0, dot) : name
    const ext = dot > 0 ? name.substring(dot + 1) : ""
    const safeBase = base.replace(/[^a-zA-Z0-9-_]+/g, "_")
    const key = ext ? `${safeBase}-${rand}.${ext}` : `${safeBase}-${rand}`

    // If provider exposes initiateMultipartUpload, use it
    if (provider && typeof provider.initiateMultipartUpload === "function") {
      const init = await provider.initiateMultipartUpload({ name, type, size, access, key })
      const uploadId = init?.upload_id || init?.uploadId
      const partSize = init?.part_size || 8 * 1024 * 1024
      if (!uploadId) {
        throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "Provider failed to initiate multipart upload")
      }
      return res.status(200).json({
        uploadId,
        key: init?.key || key,
        bucket: init?.bucket,
        region: init?.region,
        partSize,
        existingAlbumIds: body?.existingAlbumIds || [],
      })
    }

    // Fallback to direct AWS SDK if provider does not support multipart
    const { client, cfg } = getS3Client()
    const cmd = new CreateMultipartUploadCommand({
      Bucket: cfg.bucket,
      Key: key,
      ContentType: type,
      ACL: access === "public" ? "public-read" : undefined,
    })

    const resp = await client.send(cmd)
    if (!resp.UploadId) {
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "Failed to initiate multipart upload")
    }

    const partSize = 8 * 1024 * 1024

    return res.status(200).json({
      uploadId: resp.UploadId,
      key,
      bucket: cfg.bucket,
      region: cfg.region,
      partSize,
      existingAlbumIds: body?.existingAlbumIds || [],
    })
  } catch (error) {
    if (error instanceof MedusaError) {
      const status = error.type === MedusaError.Types.INVALID_DATA ? 400 : 500
      return res.status(status).json({ message: (error as Error).message })
    }
    return res.status(500).json({ message: (error as any)?.message || "Unexpected error during multipart initiate" })
  }
}
