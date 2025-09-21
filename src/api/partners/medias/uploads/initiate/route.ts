import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { CreateMultipartUploadCommand } from "@aws-sdk/client-s3"
import crypto from "crypto"
import { getS3Client } from "../../../../admin/medias/uploads/s3"
import { refetchPartnerForThisAdmin } from "../../../helpers"

interface InitiateBody {
  name: string
  type: string
  size: number
  access?: "public" | "private"
  folderPath?: string
}

export const POST = async (req: AuthenticatedMedusaRequest<InitiateBody>, res: MedusaResponse) => {
  try {
    // Partner auth
    const adminId = req.auth_context.actor_id
    const partnerAdmin = await refetchPartnerForThisAdmin(adminId, req.scope)
    if (!partnerAdmin) {
      return res.status(401).json({ message: "Partner authentication required" })
    }

    const body = (req as any).validatedBody || (req.body as any)
    const name = body?.name as string
    const type = body?.type as string
    const size = Number(body?.size)
    const access = (body?.access as "public" | "private") || "public"

    if (!name || !type || !Number.isFinite(size)) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Missing required fields: name, type, size")
    }

    // Provider-aware path identical to admin flow
    const fileService: any = req.scope.resolve(Modules.FILE)
    const provider = fileService?.getProvider ? await fileService.getProvider() : null

    // Generate a flat filename at bucket root: <originalNameSansExt>-<rand>.<ext>
    // This produces URLs like https://automatic.jaalyantra.com/IMG_2472-<rand>.jpeg
    const rand = crypto.randomBytes(8).toString("hex")
    const dot = name.lastIndexOf(".")
    const base = dot > 0 ? name.substring(0, dot) : name
    const ext = dot > 0 ? name.substring(dot + 1) : ""
    const safeBase = base.replace(/[^a-zA-Z0-9-_]+/g, "_")
    const key = ext ? `${safeBase}-${rand}.${ext}` : `${safeBase}-${rand}`

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
      })
    }

    const { client, cfg } = getS3Client()
    const cmd = new CreateMultipartUploadCommand({
      Bucket: cfg.bucket,
      Key: ext ? `${safeBase}-${rand}.${ext}` : `${safeBase}-${rand}`,
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
    })
  } catch (error) {
    if (error instanceof MedusaError) {
      const status = error.type === MedusaError.Types.INVALID_DATA ? 400 : 500
      return res.status(status).json({ message: (error as Error).message })
    }
    return res.status(500).json({ message: (error as any)?.message || "Unexpected error during multipart initiate" })
  }
}
