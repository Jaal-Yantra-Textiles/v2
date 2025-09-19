import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
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

    const { client, cfg } = getS3Client()

    const date = new Date()
    const y = date.getUTCFullYear()
    const m = String(date.getUTCMonth() + 1).padStart(2, "0")
    const d = String(date.getUTCDate()).padStart(2, "0")
    const rand = crypto.randomBytes(8).toString("hex")

    // Optional folderPath from client (sanitized to avoid leading //)
    const prefix = (body?.folderPath || "uploads").replace(/^\/+/, "").replace(/\/+/g, "/")
    const key = `${prefix}/${y}/${m}/${d}/${rand}-${name}`

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

    // Sensible default part size: 8MB
    const partSize = 8 * 1024 * 1024

    return res.status(200).json({
      uploadId: resp.UploadId,
      key,
      bucket: cfg.bucket,
      region: cfg.region,
      partSize,
      // Echo back album IDs for client context if provided
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
