import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { UploadPartCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { getS3Client } from "../s3"

interface PartsBody {
  uploadId: string
  key: string
  partNumbers: number[]
}

export const POST = async (req: MedusaRequest<PartsBody>, res: MedusaResponse) => {
  try {
    const body = (req as any).validatedBody || (req.body as any)
    const uploadId = body?.uploadId as string
    const key = body?.key as string
    const partNumbers = (body?.partNumbers as number[]) || []

    if (!uploadId || !key || !Array.isArray(partNumbers) || partNumbers.length === 0) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Missing required fields: uploadId, key, partNumbers")
    }

    const { client, cfg } = getS3Client()

    const urls: { partNumber: number; url: string }[] = []

    for (const partNumber of partNumbers) {
      const cmd = new UploadPartCommand({
        Bucket: cfg.bucket,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
      })
      const url = await getSignedUrl(client as any, cmd as any, { expiresIn: 60 * 15 }) // 15 minutes
      urls.push({ partNumber, url })
    }

    return res.status(200).json({ urls })
  } catch (error) {
    if (error instanceof MedusaError) {
      const status = error.type === MedusaError.Types.INVALID_DATA ? 400 : 500
      return res.status(status).json({ message: (error as Error).message })
    }
    return res.status(500).json({ message: (error as any)?.message || "Unexpected error while generating part URLs" })
  }
}
