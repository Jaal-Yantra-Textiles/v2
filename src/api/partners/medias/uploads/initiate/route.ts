/**
 * @file Partner API route for initiating multipart media uploads
 * @description Provides endpoints for partners to initiate multipart uploads for media files in the JYT Commerce platform
 * @module API/Partners/MediaUploads
 */

/**
 * @typedef {Object} InitiateUploadRequest
 * @property {string} name.required - The original filename including extension
 * @property {string} type.required - The MIME type of the file
 * @property {number} size.required - The size of the file in bytes
 * @property {string} [access=public] - The access level for the uploaded file (public/private)
 * @property {string} [folderPath] - Optional folder path for organizing files
 */

/**
 * @typedef {Object} InitiateUploadResponse
 * @property {string} uploadId - The unique identifier for the multipart upload session
 * @property {string} key - The generated object key for the file in storage
 * @property {string} bucket - The storage bucket name
 * @property {string} region - The storage region
 * @property {number} partSize - The recommended part size for upload chunks in bytes
 */

/**
 * Initiate a multipart upload for media files
 * @route POST /partners/medias/uploads/initiate
 * @group MediaUploads - Operations related to media file uploads
 * @param {InitiateUploadRequest} request.body.required - Upload initiation parameters
 * @returns {InitiateUploadResponse} 200 - Multipart upload session details
 * @throws {MedusaError} 400 - Invalid input data (missing required fields)
 * @throws {MedusaError} 401 - Unauthorized (partner authentication required)
 * @throws {MedusaError} 500 - Unexpected error during upload initiation
 *
 * @example request
 * POST /partners/medias/uploads/initiate
 * {
 *   "name": "product_image.jpg",
 *   "type": "image/jpeg",
 *   "size": 2048576,
 *   "access": "public"
 * }
 *
 * @example response 200
 * {
 *   "uploadId": "abc123def456ghi789",
 *   "key": "product_image-7a2b3c4d.jpg",
 *   "bucket": "jyt-commerce-media",
 *   "region": "us-east-1",
 *   "partSize": 8388608
 * }
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { CreateMultipartUploadCommand } from "@aws-sdk/client-s3"
import crypto from "crypto"
import { getS3Client } from "../../../../admin/medias/uploads/s3"
import { getPartnerFromAuthContext } from "../../../helpers"

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
    const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
    if (!partner) {
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
