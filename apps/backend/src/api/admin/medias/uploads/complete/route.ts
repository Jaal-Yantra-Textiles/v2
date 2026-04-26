
/**
 * Complete a multipart upload and finalize media records.
 *
 * This route completes an S3 multipart upload (or delegates to a configured file provider
 * that implements completeMultipartUpload), constructs a public URL for the uploaded object,
 * and runs the internal finalizeS3MediaWorkflow to create/update DB records, link albums/folders,
 * and persist metadata.
 *
 * Request body (CompleteBody):
 * - uploadId: string — multipart upload id (required)
 * - key: string — object key/path (required)
 * - parts: Array<{ PartNumber: number; ETag: string }> — parts list (required, non-empty)
 * - name: string — original filename (required)
 * - type: string — MIME type (required)
 * - size: number — file size in bytes (required)
 * - existingAlbumIds?: string[] — optional album ids to attach
 * - existingFolderId?: string — optional folder id to attach
 * - metadata?: Record<string, any> — optional arbitrary metadata
 *
 * Behavior:
 * - Validates required fields and throws MedusaError.Types.INVALID_DATA on missing/invalid input.
 * - If a file provider exposing completeMultipartUpload exists, calls provider.completeMultipartUpload:
 *   expects provider response with .location or .url.
 * - Otherwise, uses AWS S3 CompleteMultipartUploadCommand via getS3Client(), sending parts sorted by part number.
 * - Public URL selection:
 *   - If FILE_PUBLIC_BASE or S3_FILE_URL env var is set, it overrides any provider URL and is used to build the public URL.
 *   - Else uses provider response or getPublicUrl(key) as fallback.
 * - Calls finalizeS3MediaWorkflow(req.scope).run(...) with file info to persist media and link albums/folders.
 * - If finalize workflow returns errors, throws MedusaError.Types.UNEXPECTED_STATE with aggregated messages.
 *
 * Environment variables:
 * - FILE_PUBLIC_BASE or S3_FILE_URL — optional explicit public base URL to override provider/S3 URL.
 *
 * Responses:
 * - 200: { message: "Upload completed", s3: { location: string, key: string }, result: any } on success.
 * - 400: when input validation fails (MedusaError.Types.INVALID_DATA).
 * - 500: on provider/S3 errors, workflow failures, or unexpected errors.
 *
 * @param req - MedusaRequest<CompleteBody>; uses req.validatedBody if present, otherwise req.body.
 * @param res - MedusaResponse used to send JSON responses and appropriate HTTP status codes.
 *
 * @throws {MedusaError} INVALID_DATA when required fields are missing or invalid.
 * @throws {MedusaError} UNEXPECTED_STATE when finalizing media in the application domain fails.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { CompleteMultipartUploadCommand } from "@aws-sdk/client-s3"
import { getS3Client, getPublicUrl } from "../s3"
import { finalizeS3MediaWorkflow } from "../../../../../workflows/media/finalize-s3-media"

interface CompleteBody {
  uploadId: string
  key: string
  parts: { PartNumber: number; ETag: string }[]
  name: string
  type: string
  size: number
  existingAlbumIds?: string[]
  existingFolderId?: string
  metadata?: Record<string, any>
}

export const POST = async (req: MedusaRequest<CompleteBody>, res: MedusaResponse) => {
  try {
    const body = (req as any).validatedBody || (req.body as any)
    const uploadId = body?.uploadId as string
    const key = body?.key as string
    const parts = (body?.parts as { PartNumber: number; ETag: string }[]) || []
    const name = body?.name as string
    const type = body?.type as string
    const size = Number(body?.size)

    if (!uploadId || !key || !Array.isArray(parts) || parts.length === 0) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Missing required fields: uploadId, key, parts")
    }
    if (!name || !type || !Number.isFinite(size)) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Missing required fields: name, type, size")
    }

    // Prefer provider if it supports completeMultipartUpload
    const fileService: any = req.scope.resolve(Modules.FILE)
    const provider = fileService?.getProvider ? await fileService.getProvider() : null

    let url: string | undefined
    // If FILE_PUBLIC_BASE/S3_FILE_URL is configured, we will use it regardless of provider's location
    const publicBase = (process.env.FILE_PUBLIC_BASE || process.env.S3_FILE_URL)?.replace(/\/$/, "")
    if (provider && typeof provider.completeMultipartUpload === "function") {
      const providerResp = await provider.completeMultipartUpload({
        upload_id: uploadId,
        key,
        parts: parts.map((p) => ({ etag: p.ETag, part_number: p.PartNumber })),
      })
      url = providerResp?.location || providerResp?.url
    } else {
      const { client, cfg } = getS3Client()
      const sortedParts = [...parts].sort((a, b) => a.PartNumber - b.PartNumber)
      const cmd = new CompleteMultipartUploadCommand({
        Bucket: cfg.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: sortedParts.map((p) => ({ ETag: p.ETag, PartNumber: p.PartNumber })),
        },
      })
      await client.send(cmd)
      // Build a public URL for the stored object (will be overridden by publicBase if set)
      url = getPublicUrl(key)
    }
    // Prefer explicit public base if configured (override regardless of provider return)
    if (publicBase) {
      url = `${publicBase}/${key.replace(/^\/+/, "")}`
    } else if (!url) {
      url = getPublicUrl(key)
    }

    // Finalize in our domain (DB records, album links)
    const { result, errors } = await finalizeS3MediaWorkflow(req.scope).run({
      input: {
        files: [
          {
            key,
            url,
            filename: name,
            mimeType: type,
            size,
          },
        ],
        existingFolderId: body?.existingFolderId,
        existingAlbumIds: body?.existingAlbumIds,
        metadata: body?.metadata,
      },
    })

    if (errors.length) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Failed to finalize media: ${errors.map((e) => e.error?.message || "Unknown").join(", ")}`
      )
    }

    return res.status(200).json({
      message: "Upload completed",
      s3: { location: url, key },
      result,
    })
  } catch (error) {
    if (error instanceof MedusaError) {
      const status = error.type === MedusaError.Types.INVALID_DATA ? 400 : 500
      return res.status(status).json({ message: (error as Error).message })
    }
    return res.status(500).json({ message: (error as any)?.message || "Unexpected error while completing upload" })
  }
}
