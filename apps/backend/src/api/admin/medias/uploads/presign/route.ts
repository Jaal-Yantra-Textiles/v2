/**
 * @api {post} /admin/medias/uploads/presign Generate Presigned Upload URL
 * @apiName GeneratePresignedUploadURL
 * @apiGroup Media
 * @apiDescription Generates a presigned URL for uploading a file to the configured file storage provider.
 *
 * @apiBody {String} name The name of the file to be uploaded.
 * @apiBody {String} type The MIME type of the file.
 * @apiBody {Number} size The size of the file in bytes.
 * @apiBody {String="public","private"} [access="public"] The access level for the file.
 *
 * @apiSuccess {String} url The presigned URL for uploading the file.
 * @apiSuccess {String} file_key The unique identifier for the file in the storage provider.
 * @apiSuccess {String} name The name of the file.
 * @apiSuccess {String} type The MIME type of the file.
 * @apiSuccess {Number} size The size of the file in bytes.
 * @apiSuccess {String} [extension] The file extension.
 *
 * @apiSuccessExample Success-Response:
 *     HTTP/1.1 200 OK
 *     {
 *       "url": "https://storage-provider.com/upload-url",
 *       "file_key": "unique-file-key",
 *       "name": "example.jpg",
 *       "type": "image/jpeg",
 *       "size": 1024,
 *       "extension": "jpg"
 *     }
 *
 * @apiError (400: Invalid Data) {String} message "Missing required fields: type, size"
 * @apiError (500: Unexpected State) {String} message "File service provider not available"
 * @apiError (500: Unexpected State) {String} message "Active file provider does not support presigned uploads"
 * @apiError (500: Unexpected Error) {String} message "Unexpected error generating presigned URL"
 *
 * @apiErrorExample Error-Response:
 *     HTTP/1.1 400 Bad Request
 *     {
 *       "message": "Missing required fields: type, size"
 *     }
 *
 * @apiExample {curl} Example usage:
 *     curl -X POST \
 *       http://localhost:9000/admin/medias/uploads/presign \
 *       -H 'Content-Type: application/json' \
 *       -d '{
 *             "name": "example.jpg",
 *             "type": "image/jpeg",
 *             "size": 1024,
 *             "access": "public"
 *           }'
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError, Modules } from "@medusajs/framework/utils"

interface PresignBody {
  name: string
  type: string
  size: number
  access?: "public" | "private"
}

export const POST = async (req: MedusaRequest<PresignBody>, res: MedusaResponse) => {
  try {
    const body = (req as any).validatedBody || (req.body as any)
    let name = (body?.name as string) || (body?.file_name as string) || (body?.filename as string)
    const type = (body?.type as string) || (body?.mime_type as string) || (body?.content_type as string)
    const size = Number(body?.size)
    const access = (body?.access as "public" | "private") || "public"

    // Generate a filename if missing and provider complains
    if (!name) {
      const extFromType = typeof type === "string" && type.includes("/") ? type.split("/").pop() : "bin"
      name = `upload-${Date.now()}.${extFromType || "bin"}`
    }
    if (!type || !Number.isFinite(size)) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Missing required fields: type, size")
    }

    // Resolve File Service and provider from DI
    const fileService: any = req.scope.resolve(Modules.FILE)
    if (!fileService?.getProvider) {
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "File service provider not available")
    }

    const provider = await fileService.getProvider()
    if (!provider?.getPresignedUploadUrl) {
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "Active file provider does not support presigned uploads")
    }

    const extension = (name.includes(".") ? name.split(".").pop() : undefined) || (typeof type === "string" && type.includes("/") ? type.split("/").pop() : undefined)
    const resp = await provider.getPresignedUploadUrl({
      name,
      file_name: name,
      filename: name,
      original_name: name,
      type,
      mime_type: type,
      content_type: type,
      size,
      extension,
      access,
    })
    // Expect shape: { url, file_key, name, type, size, extension? }

    return res.status(200).json(resp)
  } catch (error) {
    if (error instanceof MedusaError) {
      const status = error.type === MedusaError.Types.INVALID_DATA ? 400 : 500
      return res.status(status).json({ message: (error as Error).message })
    }
    return res.status(500).json({ message: (error as any)?.message || "Unexpected error generating presigned URL" })
  }
}
