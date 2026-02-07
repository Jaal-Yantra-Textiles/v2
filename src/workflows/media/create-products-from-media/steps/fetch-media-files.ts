import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

export type FetchMediaFilesInput = {
    folder_name?: string
    folder_id?: string
    media_ids?: string[]
}

export const fetchMediaFilesStep = createStep(
    "fetch-media-files-step",
    async (input: FetchMediaFilesInput, { container }) => {
        const query = container.resolve(ContainerRegistrationKeys.QUERY) as any

        let filters: any = {}

        // Priority: media_ids > folder_id > folder_name
        if (input.media_ids && input.media_ids.length > 0) {
            filters.id = input.media_ids
        } else if (input.folder_id) {
            filters.folder_id = input.folder_id
        } else if (input.folder_name) {
            // Find folder by name first
            const { data: folders } = await query.graph({
                entity: "media_folder",
                filters: { name: input.folder_name },
                fields: ["id", "name"],
            })

            if (folders && folders.length > 0) {
                filters.folder_id = folders[0].id
            } else {
                throw new Error(`Folder "${input.folder_name}" not found`)
            }
        }

        // Fetch media files (only images)
        const { data: mediaFiles } = await query.graph({
            entity: "media_file",
            filters: {
                ...filters,
                file_type: "image", // Only process images
            },
            fields: ["id", "file_name", "file_path", "mime_type", "metadata", "folder_id"],
        })

        if (!mediaFiles || mediaFiles.length === 0) {
            throw new Error("No image files found with the given criteria")
        }

        return new StepResponse(
            {
                mediaFiles,
                totalCount: mediaFiles.length,
            },
            { mediaFileIds: mediaFiles.map((m: any) => m.id) }
        )
    },
    async (compensateData, { container }) => {
        // No rollback needed for read operation
    }
)
