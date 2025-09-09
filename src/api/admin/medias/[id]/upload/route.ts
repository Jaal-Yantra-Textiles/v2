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
