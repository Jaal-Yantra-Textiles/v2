/**
 * @api {post} /admin/medias/uploads/parts Generate presigned URLs for S3 multipart upload parts
 * @apiName GeneratePartUrls
 * @apiGroup Media
 * @apiDescription Generates presigned URLs for uploading individual parts of a multipart upload to S3.
 *
 * This endpoint handles the generation of presigned URLs for each part of a multipart upload to S3.
 * It first attempts to use the provider's presigning capabilities if available, falling back to
 * the AWS SDK's presigner if necessary.
 *
 * @apiParam {String} uploadId The upload ID of the multipart upload.
 * @apiParam {String} key The key of the object in S3.
 * @apiParam {Number[]} partNumbers An array of part numbers for which to generate presigned URLs.
 *
 * @apiSuccess {Object[]} urls An array of objects containing part numbers and their corresponding presigned URLs.
 * @apiSuccess {Number} urls.partNumber The part number.
 * @apiSuccess {String} urls.url The presigned URL for uploading the part.
 *
 * @apiError (400: Invalid Data) {String} message "Missing required fields: uploadId, key, partNumbers"
 * @apiError (500: Internal Server Error) {String} message Error message indicating the failure reason.
 *
 * @apiExample {json} Request Example:
 *     {
 *       "uploadId": "example-upload-id",
 *       "key": "example-key",
 *       "partNumbers": [1, 2, 3]
 *     }
 *
 * @apiExample {json} Success Response:
 *     HTTP/1.1 200 OK
 *     {
 *       "urls": [
 *         {
 *           "partNumber": 1,
 *           "url": "https://example-bucket.s3.amazonaws.com/example-key?partNumber=1&uploadId=example-upload-id&X-Amz-Signature=..."
 *         },
 *         {
 *           "partNumber": 2,
 *           "url": "https://example-bucket.s3.amazonaws.com/example-key?partNumber=2&uploadId=example-upload-id&X-Amz-Signature=..."
 *         },
 *         {
 *           "partNumber": 3,
 *           "url": "https://example-bucket.s3.amazonaws.com/example-key?partNumber=3&uploadId=example-upload-id&X-Amz-Signature=..."
 *         }
 *       ]
 *     }
 *
 * @apiExample {json} Error Response:
 *     HTTP/1.1 400 Bad Request
 *     {
 *       "message": "Missing required fields: uploadId, key, partNumbers"
 *     }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError, Modules } from "@medusajs/framework/utils"
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

    // Prefer provider if it supports presigning part uploads
    const fileService: any = req.scope.resolve(Modules.FILE)
    const provider = fileService?.getProvider ? await fileService.getProvider() : null

    if (provider) {
      // Try plural API first
      if (typeof provider.getPresignedPartUrls === "function") {
        const resp = await provider.getPresignedPartUrls({ upload_id: uploadId, key, part_numbers: partNumbers })
        const urls = (resp?.urls || resp || []).map((u: any) => ({ partNumber: u.part_number || u.partNumber, url: u.url }))
        if (urls.length) return res.status(200).json({ urls })
      }
      // Try singular API fallback
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
