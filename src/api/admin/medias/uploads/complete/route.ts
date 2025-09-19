import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
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

    const { client, cfg } = getS3Client()

    // Ensure parts are sorted by PartNumber
    const sortedParts = [...parts].sort((a, b) => a.PartNumber - b.PartNumber)

    const cmd = new CompleteMultipartUploadCommand({
      Bucket: cfg.bucket,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: sortedParts.map((p) => ({ ETag: p.ETag, PartNumber: p.PartNumber })),
      },
    })

    const resp = await client.send(cmd)

    // Build a public URL for the stored object
    const url = getPublicUrl(key)

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
      s3: { location: resp.Location, key, bucket: cfg.bucket },
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
