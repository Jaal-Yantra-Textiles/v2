import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { UploadPartCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { getS3Client } from "../../../../admin/medias/uploads/s3"
import { refetchPartnerForThisAdmin } from "../../../helpers"

interface PartsBody {
  uploadId: string
  key: string
  partNumbers: number[]
}

export const POST = async (req: AuthenticatedMedusaRequest<PartsBody>, res: MedusaResponse) => {
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
    const partNumbers = (body?.partNumbers as number[]) || []

    if (!uploadId || !key || !Array.isArray(partNumbers) || partNumbers.length === 0) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Missing required fields: uploadId, key, partNumbers")
    }

    // Prefer provider if it supports presigning part uploads
    const fileService: any = req.scope.resolve(Modules.FILE)
    const provider = fileService?.getProvider ? await fileService.getProvider() : null

    if (provider) {
      if (typeof provider.getPresignedPartUrls === "function") {
        const resp = await provider.getPresignedPartUrls({ upload_id: uploadId, key, part_numbers: partNumbers })
        const urls = (resp?.urls || resp || []).map((u: any) => ({ partNumber: u.part_number || u.partNumber, url: u.url }))
        if (urls.length) return res.status(200).json({ urls })
      }
      if (typeof provider.getPresignedPartUrl === "function") {
        const urls: { partNumber: number; url: string }[] = []
        for (const pn of partNumbers) {
          const u = await provider.getPresignedPartUrl({ upload_id: uploadId, key, part_number: pn })
          urls.push({ partNumber: pn, url: u?.url })
        }
        if (urls.length) return res.status(200).json({ urls })
      }
    }

    // Fallback to AWS SDK presigner
    const { client, cfg } = getS3Client()
    const urls: { partNumber: number; url: string }[] = []
    for (const partNumber of partNumbers) {
      const cmd = new UploadPartCommand({ Bucket: cfg.bucket, Key: key, UploadId: uploadId, PartNumber: partNumber })
      const url = await getSignedUrl(client as any, cmd as any, { expiresIn: 60 * 15 })
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
