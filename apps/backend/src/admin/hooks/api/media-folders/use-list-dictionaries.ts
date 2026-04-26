import { useQuery, UseQueryOptions } from "@tanstack/react-query"
import { VITE_MEDUSA_BACKEND_URL } from "../../../lib/config"

export type MediaFolderListItem = { id: string; name: string; slug?: string }
export type MediaAlbumListItem = { id: string; name: string }

export type ListMediaDictionariesResponse = {
  folders: MediaFolderListItem[]
  albums: MediaAlbumListItem[]
}

export const useListMediaDictionaries = (
  options?: UseQueryOptions<ListMediaDictionariesResponse, Error>
) => {
  return useQuery<ListMediaDictionariesResponse, Error>({
    queryKey: ["media-dictionaries"],
    queryFn: async () => {
      const base = VITE_MEDUSA_BACKEND_URL?.replace(/\/$/, "") || ""
      const url = `${base}/admin/medias/existdir`
      const res = await fetch(url, { credentials: "include" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.message || `Failed to load media dictionaries (${res.status})`)
      }
      return data as ListMediaDictionariesResponse
    },
    staleTime: 60_000,
    ...options,
  })
}
