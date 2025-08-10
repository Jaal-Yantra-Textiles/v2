import { createWorkflow, WorkflowResponse, transform } from "@medusajs/framework/workflows-sdk"
import { getFolderWorkflow } from "./get-folder"
import { listAlbumMediaWorkflow } from "./list-album-media"
import { listAlbumWorkflow } from "./list-album"

export type GetFolderDetailInput = {
  id: string
  config?: {
    select?: string[]
    relations?: string[]
  }
}

export const getFolderDetailWorkflow = createWorkflow(
  "get-folder-detail",
  (input: GetFolderDetailInput) => {
    // 1) Retrieve folder with relations
    const folderRes = getFolderWorkflow.runAsStep({
      input: transform({ input }, (data) => ({
        id: data.input.id,
        config: data.input.config ?? { relations: ["parent_folder", "child_folders", "media_files"] },
      })),
    })

    // 2) Extract media ids from folder
    const mediaIds = transform({ folderRes }, ({ folderRes }: any) => {
      const media = folderRes?.media_files || []
      return media.map((m: any) => m.id)
    })

    // 3) Fetch album-media for those files
    const albumMediaRes = listAlbumMediaWorkflow.runAsStep({
      input: transform({ mediaIds }, ({ mediaIds }) => ({
        // AlbumMedia has relation `media` (belongsTo MediaFile). Filter via relation field.
        filters: mediaIds && mediaIds.length ? { media: { id: { $in: mediaIds } } } : {},
        // Request album relation so we can extract album IDs below
        config: { take: 100, skip: 0, relations: ["album"] },
      })),
    })

    // 4) Extract album ids from album-media
    const albumIds = transform({ albumMediaRes }, ({ albumMediaRes }: any) => {
      const items = albumMediaRes?.[0] || [] // list workflows return [data, count]
      const ids = Array.from(new Set(items.map((am: any) => am?.album?.id).filter(Boolean)))
      return ids
    })

    // 5) Fetch albums
    const albumsRes = listAlbumWorkflow.runAsStep({
      input: transform({ albumIds }, ({ albumIds }) => ({
        filters: albumIds && albumIds.length ? { id: { $in: albumIds } } : {},
        config: { take: 100, skip: 0 },
      })),
    })

    // 6) Shape final response
    const result = transform({ folderRes, albumMediaRes, albumsRes }, ({ folderRes, albumMediaRes, albumsRes }: any) => {
      const folder = folderRes
      const media_files = folder?.media_files || []
      const child_folders = folder?.child_folders || []
      const [album_media = [], album_media_count = 0] = albumMediaRes || []
      const [albums = [], albums_count = 0] = albumsRes || []

      return {
        folder,
        media_files,
        child_folders,
        album_media,
        album_media_count,
        albums,
        albums_count,
      }
    })

    return new WorkflowResponse(result)
  }
)
