import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { sdk } from "../../lib/config"
import { toast } from "@medusajs/ui"
import { AdminMediaFolder } from "./media-folders"

const designMediaFolderKey = (designId: string) => ["design-media-folder", designId]

export const useDesignMediaFolder = (designId: string) => {
  return useQuery<AdminMediaFolder | null>({
    queryKey: designMediaFolderKey(designId),
    queryFn: async () => {
      const res = await sdk.client.fetch<{ data: any[] }>(
        `/admin/query/graph`,
        {
          method: "POST",
          body: {
            entity: "design",
            filters: { id: designId },
            fields: [
              "folders.*",
              "folders.media_files.*",
            ],
          },
        }
      )
      return res?.data?.[0]?.folders?.[0] ?? null
    },
    staleTime: 30_000,
  })
}

export const useLinkDesignMediaFolder = (designId: string) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (folder_id: string) => {
      return sdk.client.fetch(`/admin/designs/${designId}/link-media-folder`, {
        method: "POST",
        body: { folder_id },
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: designMediaFolderKey(designId) })
      toast.success("Media folder linked to design")
    },
    onError: (err: any) => {
      toast.error(err?.message || "Failed to link media folder")
    },
  })
}

export const useUnlinkDesignMediaFolder = (designId: string) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      return sdk.client.fetch(`/admin/designs/${designId}/link-media-folder`, {
        method: "DELETE",
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: designMediaFolderKey(designId) })
      toast.success("Media folder unlinked")
    },
    onError: (err: any) => {
      toast.error(err?.message || "Failed to unlink media folder")
    },
  })
}
