
/**
 * POST /admin/medias/:id/upload (DEPRECATED)
 *
 * Legacy route handler to upload one or more media files into an existing folder.
 * Soft-deprecated: sets the "Deprecation" response header and a "Link" header
 * pointing to the successor route POST /admin/medias/folder/:id/upload.
 *
 * Behavior:
 * - Treats req.params.id as the target folder ID (existingFolderId).
 * - Accepts single-file (req.file) or multi-file (req.files) uploads from Multer.
 * - Normalizes files into objects with { filename, mimeType, content, size, _tempPath }.
 *   - If Multer provides a Buffer, the content is read from buffer.
 *   - If Multer provides a temp file path, the content is read from fs (binary string).
 * - Calls uploadAndOrganizeMediaWorkflow(req.scope).run({ input: { files, existingFolderId } }).
 * - If workflow returns errors, throws a MedusaError(UNEXPECTED_STATE).
 * - Attempts to cleanup any temp files referenced by _tempPath (best-effort).
 * - On success returns JSON { deprecated: true, next: "/admin/medias/folder/:id/upload", result }.
 *
 * Response headers:
 * - Deprecation: "true"
 * - Link: </admin/medias/folder/:id/upload>; rel="successor-version"
 *
 * Error handling:
 * - Missing folder id or missing uploaded files -> MedusaError.Types.INVALID_DATA (400).
 * - Workflow errors -> MedusaError.Types.UNEXPECTED_STATE (500).
 * - Other exceptions -> 500 with message.
 *
 * @deprecated Use POST /admin/medias/folder/:id/upload instead.
 *
 * @param req - MedusaRequest augmented with optional Multer fields:
 *   - req.params.id: string | undefined (folder id)
 *   - req.file?: Express.Multer.File (single file)
 *   - req.files?: Express.Multer.File[] (multiple files)
 *   - req.scope: DI scope used to resolve/workflow services
 *
 * @param res - MedusaResponse used to set headers and return JSON responses
 *
 * @throws {MedusaError} INVALID_DATA when folder id is missing or no files provided
 * @throws {MedusaError} UNEXPECTED_STATE when workflow returns upload errors
 *
 * @example Single-file upload (curl)
 * ```bash
 * curl -i -X POST "https://your-server.com/admin/medias/123/upload" \
 *   -H "Authorization: Bearer <admin_token>" \
 *   -F "file=@/path/to/image.jpg"
 * ```
 *
 * Example success response (200):
 * ```json
 * {
 *   "deprecated": true,
 *   "next": "/admin/medias/folder/123/upload",
 *   "result": {
 *     /* workflow result object (created/organized media entries) *\/
 *   }
 * }
 * ```
 *
 * @example Multi-file upload (curl)
 * ```bash
 * curl -i -X POST "https://your-server.com/admin/medias/123/upload" \
 *   -H "Authorization: Bearer <admin_token>" \
 *   -F "files=@/path/to/image1.jpg" \
 *   -F "files=@/path/to/image2.png"
 * ```
 *
 * Example error responses:
 * - Missing folder id -> 400 { "message": "Folder ID is required" }
 * - No files provided -> 400 { "message": "No files provided for upload" }
 * - Workflow failure -> 500 { "message": "Failed to upload media: <error messages>" }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { uploadAndOrganizeMediaWorkflow } from "../../../../../workflows/media/upload-and-organize-media"
import fs from "fs"

// DEPRECATED: Use POST /admin/medias/folder/:id/upload instead
export const POST = async (
  req: MedusaRequest & { files?: Express.Multer.File[]; file?: Express.Multer.File },
  res: MedusaResponse
) => {
  // Soft deprecation notice in headers
  res.setHeader("Deprecation", "true")
  res.setHeader(
    "Link",
    `</admin/medias/folder/${req.params.id}/upload>; rel="successor-version"`
  )

  try {
    // Treat :id as folder ID for backward compatibility
    const folderId = (req.params as any).id as string | undefined
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

    const files = uploadedFiles.map((file) => {
      const hasBuffer = (file as any).buffer && Buffer.isBuffer((file as any).buffer)
      const hasPath = (file as any).path && typeof (file as any).path === "string"
      const contentStr = hasBuffer
        ? (file as any).buffer.toString("binary")
        : hasPath
          ? fs.readFileSync((file as any).path).toString("binary")
          : ""
      return {
        filename: file.originalname,
        mimeType: file.mimetype,
        content: contentStr,
        size: file.size,
        _tempPath: hasPath ? (file as any).path : undefined,
      } as any
    })

    const { result, errors } = await uploadAndOrganizeMediaWorkflow(req.scope).run({
      input: {
        files,
        existingFolderId: folderId,
      },
    })

    if (errors.length > 0) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Failed to upload media: ${errors.map((e) => e.error?.message || "Unknown error").join(", ")}`
      )
    }

    // Cleanup temp files if any
    try {
      for (const f of files as any[]) {
        if (f._tempPath) {
          fs.unlink(f._tempPath, () => {})
        }
      }
    } catch {}

    return res.status(200).json({
      deprecated: true,
      next: `/admin/medias/folder/${folderId}/upload`,
      result,
    })
  } catch (error) {
    console.error("Folder upload error:", error)
    if (error instanceof MedusaError) {
      const status = error.type === MedusaError.Types.INVALID_DATA ? 400 : 500
      console.error("Medusa error:", error)
      return res.status(status).json({ message: (error as Error).message })
    }
    return res.status(500).json({ message: (error as any)?.message || "An unexpected error occurred in the media upload" })
  }
}
