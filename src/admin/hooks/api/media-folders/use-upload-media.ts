import { useMutation, UseMutationOptions, useQueryClient } from "@tanstack/react-query"
import { VITE_MEDUSA_BACKEND_URL } from "../../../lib/config"
import { mediasQueryKeys } from "./use-medias"

interface UploadMediaInput {
  files: File[]
  existingAlbumIds?: string[]
  // Optional future fields: metadata, folder spec, etc.
}

interface UploadMediaResponse {
  result: any
}

export const useUploadMedia = (
  options?: UseMutationOptions<UploadMediaResponse, Error, UploadMediaInput>
) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ files, existingAlbumIds }) => {
      const formData = new FormData()
      for (const file of files) {
        formData.append("files", file, file.name || "upload.bin")
      }
      if (existingAlbumIds && existingAlbumIds.length) {
        for (const id of existingAlbumIds) {
          formData.append("existingAlbumIds", id)
        }
      }

      const base = VITE_MEDUSA_BACKEND_URL?.replace(/\/$/, "") || ""
      const url = `${base}/admin/medias`

      const res = await fetch(url, {
        method: "POST",
        body: formData,
        credentials: "include",
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const message = (data && (data.message || data.error)) || `Upload failed with status ${res.status}`
        throw new Error(message)
      }
      return data as UploadMediaResponse
    },
    onSuccess: (data, variables, context) => {
      // Refresh combined medias page (folders, albums, files)
      queryClient.invalidateQueries({ queryKey: mediasQueryKeys.all })
      // Refresh dictionaries used by Selects (folders, albums)
      queryClient.invalidateQueries({ queryKey: ["media-dictionaries"] })
      // Refresh any generic media folders lists/hooks
      queryClient.invalidateQueries({ queryKey: ["media-folders", "list"] })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}
