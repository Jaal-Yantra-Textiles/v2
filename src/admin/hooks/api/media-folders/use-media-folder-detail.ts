import { useQuery, UseQueryOptions } from "@tanstack/react-query"
import { FetchError } from "@medusajs/js-sdk"
import { queryKeysFactory } from "../../../lib/query-key-factory"
import { sdk } from "../../../lib/config"
import { AdminMediaFolder } from "../media-folders"

const MEDIA_FOLDER_DETAIL_QUERY_KEY = "media_folder_detail" as const
export const mediaFolderDetailQueryKeys = queryKeysFactory(MEDIA_FOLDER_DETAIL_QUERY_KEY)

export interface AdminGetMediaFolderDetailQuery {
  // currently unused; can add select/relations if needed
}

export type AdminMediaFolderDetailResponse = {
  folder: AdminMediaFolder
  media_files: any[]
  child_folders: any[]
  album_media: any[]
  album_media_count: number
  albums: any[]
  albums_count: number
}

export const useMediaFolderDetail = (
  id: string,
  _query?: AdminGetMediaFolderDetailQuery,
  options?: Omit<
    UseQueryOptions<
      AdminMediaFolderDetailResponse,
      FetchError,
      AdminMediaFolderDetailResponse,
      any
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () =>
      sdk.client.fetch<AdminMediaFolderDetailResponse>(
        `/admin/medias/folder/${id}/detail`,
        {
          method: "GET",
        }
      ),
    queryKey: mediaFolderDetailQueryKeys.detail(id),
    ...options,
  })

  return {
    data,
    folder: data?.folder,
    ...rest,
  }
}
