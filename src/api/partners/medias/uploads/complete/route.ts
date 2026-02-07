/**
 * @file Partner API route for completing multipart media uploads
 * @description Provides an endpoint for partners to finalize multipart uploads to S3 or configured file service
 * @module API/Partners/MediaUploads
 */

/**
 * @typedef {Object} CompleteMultipartUploadBody
 * @property {string} uploadId.required - The AWS S3 multipart upload ID
 * @property {string} key.required - The object key/path in the storage bucket
 * @property {Array<Part>} parts.required - Array of uploaded parts with their ETags
 * @property {string} name.required - The original filename
 * @property {string} type.required - The MIME type of the uploaded file
 * @property {number} size.required - The total file size in bytes
 * @property {Object} [metadata] - Optional metadata to associate with the file
 */

/**
 * @typedef {Object} Part
 * @property {number} PartNumber.required - The part number (1-based index)
 * @property {string} ETag.required - The ETag returned from the part upload
 */

/**
 * @typedef {Object} CompleteUploadResponse
 * @property {string} message - Success message
 * @property {Object} s3 - S3 upload details
 * @property {string} s3.location - The public URL of the uploaded file
 * @property {string} s3.key - The storage key of the uploaded file
 */

/**
 * Complete a multipart upload
 * @route POST /partners/medias/uploads/complete
 * @group MediaUploads - Operations related to media uploads
 * @param {CompleteMultipartUploadBody} request.body.required - Multipart upload completion data
 * @returns {CompleteUploadResponse} 200 - Upload completion details
 * @throws {MedusaError} 400 - Missing required fields or invalid data
 * @throws {MedusaError} 401 - Partner authentication required
 * @throws {MedusaError} 500 - Unexpected error while completing upload
 *
 * @example request
 * POST /partners/medias/uploads/complete
 * {
 *   "uploadId": "VXBsb2FkIElEIGZvciB3b3JrZmxvd18wMDAwMDAwMDAwMDAwMDAwMDAwMDAw",
 *   "key": "partners/12345/products/image.jpg",
 *   "parts": [
 *     { "PartNumber": 1, "ETag": "\"a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4\"" },
 *     { "PartNumber": 2, "ETag": "\"b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5\"" }
 *   ],
 *   "name": "product-image.jpg",
 *   "type": "image/jpeg",
 *   "size": 1048576,
 *   "metadata": {
 *     "productId": "prod_12345",
 *     "altText": "Product showcase image"
 *   }
 * }
 *
 * @example response 200
 * {
 *   "message": "Upload completed",
 *   "s3": {
 *     "location": "https://cdn.example.com/partners/12345/products/image.jpg",
 *     "key": "partners/12345/products/image.jpg"
 *   }
 * }
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { CompleteMultipartUploadCommand } from "@aws-sdk/client-s3"
import { getS3Client, getPublicUrl } from "../../../../admin/medias/uploads/s3"
import { getPartnerFromAuthContext } from "../../../helpers"

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
    const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
    if (!partner) {
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
