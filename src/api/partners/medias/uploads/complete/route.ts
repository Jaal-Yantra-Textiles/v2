import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { CompleteMultipartUploadCommand } from "@aws-sdk/client-s3"
import { getS3Client, getPublicUrl } from "../../../../admin/medias/uploads/s3"
import { refetchPartnerForThisAdmin } from "../../../helpers"

interface CompleteBody {
  uploadId: string
  key: string
  parts: { PartNumber: number; ETag: string }[]
  name: string
  type: string
  size: number
  metadata?: Record<string, any>
}

export const POST = async (req: AuthenticatedMedusaRequest<CompleteBody>, res: MedusaResponse) => {
  try {
    // Partner auth
    const adminId = req.auth_context.actor_id
    const partnerAdmin = await refetchPartnerForThisAdmin(adminId, req.scope)
    if (!partnerAdmin) {
      return res.status(401).json({ message: "Partner authentication required" })
    }

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
        MultipartUpload: { Parts: sortedParts.map((p) => ({ ETag: p.ETag, PartNumber: p.PartNumber })) },
      })
      await client.send(cmd)
      url = getPublicUrl(key)
    }
    // Prefer explicit public base if configured (override provider location)
    {
      const base = process.env.S3_FILE_URL?.replace(/\/$/, "")
      if (base) {
        url = `${base}/${key.replace(/^\/+/, "")}`
      }
    }

    return res.status(200).json({
      message: "Upload completed",
      s3: { location: url, key },
    })
  } catch (error) {
    if (error instanceof MedusaError) {
      const status = error.type === MedusaError.Types.INVALID_DATA ? 400 : 500
      return res.status(status).json({ message: (error as Error).message })
    }
    return res.status(500).json({ message: (error as any)?.message || "Unexpected error while completing upload" })
  }
}
