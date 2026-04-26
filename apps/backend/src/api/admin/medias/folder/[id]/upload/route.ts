
/**
 * POST handler to upload one or more media files into an existing media folder.
 *
 * Route: POST /admin/medias/folder/:id/upload
 *
 * Behavior:
 * - Validates that a folder id is provided via req.params.id.
 * - Normalizes incoming multipart uploads to support either a single file (req.file)
 *   or multiple files (req.files).
 * - Converts each file to a workflow-friendly object:
 *   { filename, mimeType, content, size } where `content` is the file buffer
 *   encoded as a binary string (to avoid Buffer serialization issues in workflows).
 * - Executes the uploadAndOrganizeMediaWorkflow with input:
 *   { files: Array<{ filename, mimeType, content, size }>, existingFolderId: string }.
 * - Returns 200 with { result } on success.
 *
 * Validation / Errors:
 * - Throws MedusaError.Types.INVALID_DATA (400) when:
 *   - folder id is missing
 *   - no files are provided for upload
 * - Throws MedusaError.Types.UNEXPECTED_STATE (500) when the workflow returns errors
 *   or when unexpected failures occur during processing.
 *
 * Parameters:
 * @param req - MedusaRequest<UploadMediaRequest> extended with optional multer files:
 *                { files?: Express.Multer.File[]; file?: Express.Multer.File }
 *                - Expects multipart/form-data with either `file` (single) or `files` (multiple).
 * @param res - MedusaResponse used to return JSON responses and HTTP status codes.
 *
 * Returns:
 * @returns 200 JSON payload { result } on successful upload and organization.
 * @returns 400 JSON payload { message } for invalid input (missing folder id / no files).
 * @returns 500 JSON payload { message } for unexpected errors or workflow failures.
 *
 * Examples:
 * - Upload a single file (field name "file"):
 *   curl -X POST "https://your-medusa-host/admin/medias/folder/folder_123/upload" \
 *     -H "Authorization: Bearer <ADMIN_TOKEN>" \
 *     -F "file=@/path/to/image.jpg"
 *
 * - Upload multiple files (field name "files"):
 *   curl -X POST "https://your-medusa-host/admin/medias/folder/folder_123/upload" \
 *     -H "Authorization: Bearer <ADMIN_TOKEN>" \
 *     -F "files=@/path/to/image1.jpg" \
 *     -F "files=@/path/to/image2.png"
 *
 * - Successful response example:
 *   HTTP/1.1 200 OK
 *   Content-Type: application/json
 *   {
 *     "result": {
 *       "uploaded": [
 *         { "id": "media_1", "filename": "image1.jpg", "url": "...", /* ... *\/ },
 *         { "id": "media_2", "filename": "image2.png", "url": "...", /* ... *\/ }
 *       ]
 *     }
 *   }
 *
 * - Error response examples:
 *   HTTP/1.1 400 Bad Request
 *   { "message": "Folder ID is required" }
 *
 *   HTTP/1.1 400 Bad Request
 *   { "message": "No files provided for upload" }
 *
 *   HTTP/1.1 500 Internal Server Error
 *   { "message": "Failed to create media records: <details>" }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { uploadAndOrganizeMediaWorkflow } from "../../../../../../workflows/media/upload-and-organize-media"
import { UploadMediaRequest } from "../../../validator";
 

// POST /admin/medias/folder/:id/upload
export const POST = async (
  req: MedusaRequest<UploadMediaRequest> & { files?: Express.Multer.File[]; file?: Express.Multer.File },
  res: MedusaResponse
) => {
  try {
    const { id: folderId } = req.params as { id?: string }
    if (!folderId) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Folder ID is required")
    }
    

    // Normalize uploaded files (support single or multiple)
    const uploadedFiles: Express.Multer.File[] = Array.isArray(req.files)
      ? (req.files as Express.Multer.File[])
      : (req.file ? [req.file as Express.Multer.File] : [])

    if (!uploadedFiles || uploadedFiles.length === 0) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "No files provided for upload")
    }

    // Build workflow files using string content to avoid Buffer serialization in workflows
    const files = uploadedFiles.map((file) => ({
      filename: file.originalname,
      mimeType: file.mimetype,
      content: (file as any).buffer?.toString("binary"),
      size: file.size,
    }))

    // Single workflow: upload and organize
    const { result, errors } = await uploadAndOrganizeMediaWorkflow(req.scope).run({
      input: {
        files,
        existingFolderId: folderId,
      },
      throwOnError: true,
    })

    if (errors.length > 0) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Failed to create media records: ${errors.map((e) => e.error?.message || "Unknown error").join(", ")}`
      )
    }

    return res.status(200).json({ result })
  } catch (error) {
    if (error instanceof MedusaError) {
      console.error("Folder upload Medusa error:", error)
      const status = error.type === MedusaError.Types.INVALID_DATA ? 400 : 500
      return res.status(status).json({ message: (error as Error).message })
    }
    console.error("Folder upload error:", error)
    return res.status(500).json({ message: (error as any)?.message || "An unexpected error occurred" })
  }
}
