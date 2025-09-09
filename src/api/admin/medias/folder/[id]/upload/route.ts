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
