import { useQuery, UseQueryOptions } from "@tanstack/react-query"
import { VITE_MEDUSA_BACKEND_URL } from "../../../lib/config"

export type MediaFolderListItem = {
  id: string
  name: string
  slug?: string
}

export type ListMediaFoldersResponse = {
  folders: MediaFolderListItem[]
}

export const useListMediaFolders = (
  options?: UseQueryOptions<ListMediaFoldersResponse, Error>
) => {
  return useQuery<ListMediaFoldersResponse, Error>({
    queryKey: ["media-folders", "list"],
    queryFn: async () => {
      const base = VITE_MEDUSA_BACKEND_URL?.replace(/\/$/, "") || ""
      const url = `${base}/admin/medias/existdir`
      const res = await fetch(url, { credentials: "include" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.message || `Failed to load folders (${res.status})`)
      }
      return data as ListMediaFoldersResponse
    },
    staleTime: 60_000,
    ...options,
  })
}
