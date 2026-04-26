import { createWorkflow, createStep, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { MEDIA_MODULE } from "../../modules/media"
import MediaFileService from "../../modules/media/service"

export type FinalizeS3MediaInput = {
  files: Array<{
    key: string
    url: string
    filename: string
    mimeType: string
    size: number
  }>
  existingFolderId?: string
  existingAlbumIds?: string[]
  metadata?: Record<string, any>
}

const createMediaRecordsFromS3Step = createStep(
  "create-media-records-from-s3-step",
  async (input: FinalizeS3MediaInput, { container }) => {
    const service: MediaFileService = container.resolve(MEDIA_MODULE)

    const created = [] as any[]
    for (const file of input.files) {
      const filename = file.filename || file.key.split("/").pop() || file.key
      const extension = filename.includes(".") ? filename.split(".").pop()! : ""
      const fileType = file.mimeType.startsWith("image/")
        ? "image"
        : file.mimeType.startsWith("video/")
        ? "video"
        : file.mimeType.startsWith("audio/")
        ? "audio"
        : file.mimeType.includes("pdf") || file.mimeType.includes("document")
        ? "document"
        : file.mimeType.includes("zip") || file.mimeType.includes("archive")
        ? "archive"
        : "other"

      const media = await service.createMediaFiles({
        file_name: filename,
        original_name: filename,
        file_path: file.url, // store the accessible URL or key mapping
        file_size: file.size,
        file_type: fileType as any,
        mime_type: file.mimeType,
        extension,
        ...(input.existingFolderId && { folder_id: input.existingFolderId }),
        is_public: true,
        metadata: input.metadata || {},
      })

      if (input.existingAlbumIds?.length) {
        for (const albumId of input.existingAlbumIds) {
          await service.createAlbumMedias({
            album_id: albumId,
            media_id: media.id,
            sort_order: 0,
          })
        }
      }

      created.push(media)
    }

    return new StepResponse(created, created.map(c => c.id))
  },
  async (createdIds: string[], { container }) => {
    const service: MediaFileService = container.resolve(MEDIA_MODULE)
    if (createdIds?.length) {
      await service.softDeleteMediaFiles(createdIds)
    }
  }
)

export const finalizeS3MediaWorkflow = createWorkflow(
  "finalize-s3-media",
  (input: FinalizeS3MediaInput) => {
    const created = createMediaRecordsFromS3Step(input)
    return new WorkflowResponse({
      mediaFiles: created,
      count: created.length,
    })
  }
)
