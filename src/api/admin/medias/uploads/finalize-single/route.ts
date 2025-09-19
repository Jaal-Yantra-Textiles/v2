import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { finalizeS3MediaWorkflow } from "../../../../../workflows/media/finalize-s3-media"
import { getPublicUrl } from "../s3"

interface FinalizeSingleBody {
  file_key?: string
  key?: string
  fileKey?: string
  path?: string
  object_key?: string
  objectKey?: string
  name?: string
  file_name?: string
  filename?: string
  original_name?: string
  type?: string
  mime_type?: string
  content_type?: string
  size?: number | string
  existingAlbumIds?: string[]
  existingFolderId?: string
  metadata?: Record<string, any>
}

export const POST = async (req: MedusaRequest<FinalizeSingleBody>, res: MedusaResponse) => {
  try {
    const body = (req as any).validatedBody || (req.body as any)
    const file_key: string =
      body?.file_key || body?.key || body?.fileKey || body?.path || body?.object_key || body?.objectKey
    let name: string = body?.name || body?.file_name || body?.filename || body?.original_name
    const type: string = body?.type || body?.mime_type || body?.content_type
    const sizeNum = Number(body?.size)

    if (!name) {
      const extFromType = typeof type === "string" && type.includes("/") ? type.split("/").pop() : "bin"
      name = `upload-${Date.now()}.${extFromType || "bin"}`
    }
    if (!file_key || !type || !Number.isFinite(sizeNum)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Missing required fields: file_key, type, size (name was generated if absent)"
      )
    }

    // Prefer explicit public base URL if configured (works great for MinIO/Supabase dev)
    const base = process.env.S3_FILE_URL?.replace(/\/$/, "")
    const url = base ? `${base}/${file_key.replace(/^\/+/, "")}` : getPublicUrl(file_key)

    const { result, errors } = await finalizeS3MediaWorkflow(req.scope).run({
      input: {
        files: [
          {
            key: file_key,
            url,
            filename: name,
            mimeType: type,
            size: sizeNum,
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
      message: "Single upload finalized",
      result,
    })
  } catch (error) {
    if (error instanceof MedusaError) {
      const status = error.type === MedusaError.Types.INVALID_DATA ? 400 : 500
      return res.status(status).json({ message: (error as Error).message })
    }
    return res.status(500).json({ message: (error as any)?.message || "Unexpected error while finalizing single upload" })
  }
}
