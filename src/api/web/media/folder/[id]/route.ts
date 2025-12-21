import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { getFolderDetailWorkflow } from "../../../../../workflows/media/get-folder-detail"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params as { id?: string }
  const token = typeof req.query?.token === "string" ? req.query.token : undefined

  if (!id) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Folder ID is required")
  }

  if (!token) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Share token is required")
  }

  const { result, errors } = await getFolderDetailWorkflow(req.scope).run({
    input: {
      id,
      config: {
        relations: ["media_files", "parent_folder"],
      },
    },
  })

  if (errors?.length || !result?.folder) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Folder ${id} could not be found`
    )
  }

  const folder = result.folder as any

  if (!folder.is_public) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Folder is not public")
  }

  const storedToken = folder.metadata?.share_token
  if (!storedToken || storedToken !== token) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Invalid share token")
  }

  const mediaFiles = (result.media_files || []).filter((file: any) => file?.is_public !== false)

  const sanitizedMedia = mediaFiles.map((media: any) => ({
    id: media.id,
    file_name: media.file_name,
    original_name: media.original_name,
    file_path: media.file_path,
    file_type: media.file_type,
    mime_type: media.mime_type,
    width: media.width,
    height: media.height,
    alt_text: media.alt_text,
    caption: media.caption,
    metadata: media.metadata,
  }))

  return res.status(200).json({
    folder: {
      id: folder.id,
      name: folder.name,
      description: folder.description,
      path: folder.path,
    },
    media_files: sanitizedMedia,
  })
}
