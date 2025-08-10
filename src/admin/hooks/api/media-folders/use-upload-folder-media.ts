import { useMutation, UseMutationOptions, useQueryClient } from "@tanstack/react-query";
import { mediasQueryKeys } from "./use-medias";
import { mediaFolderDetailQueryKeys } from "./use-media-folder-detail";
import { mediaFolderQueryKeys } from "./use-media-folder";

interface UploadFolderMediaInput {
  files: File[];
  folderId: string;
  metadata?: Record<string, any>;
}

interface UploadFolderMediaResponse {
  mediaFiles: any[];
  uploadedFileCount: number;
}

export const useUploadFolderMedia = (
  options?: UseMutationOptions<UploadFolderMediaResponse, Error, UploadFolderMediaInput>
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ files, folderId, metadata }) => {
      // Create FormData to send files
      const formData = new FormData();
      
      // Append files to FormData
      files.forEach((file) => {
        formData.append('files', file);
      });
      
      // Append metadata if provided
      if (metadata) {
        formData.append('metadata', JSON.stringify(metadata));
      }
      
      // Send request to API endpoint using native fetch so the browser sets multipart headers
      const res = await fetch(`/admin/medias/folder/${folderId}/upload`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({} as any))
        throw new Error(err?.message || `Upload failed with status ${res.status}`)
      }
      const data = (await res.json()) as { result: UploadFolderMediaResponse }
      return data.result;
    },
    onSuccess: (data, variables, context) => {
      // Refresh combined medias page (folders, albums, files)
      queryClient.invalidateQueries({ queryKey: mediasQueryKeys.all });
      // Refresh dictionaries used by Selects (folders, albums)
      queryClient.invalidateQueries({ queryKey: ["media-dictionaries"] });
      // Refresh any generic media folders lists/hooks
      queryClient.invalidateQueries({ queryKey: ["media-folders", "list"] });
      // Refresh this folder basic detail and composite detail
      queryClient.invalidateQueries({ queryKey: mediaFolderQueryKeys.detail(variables.folderId) });
      queryClient.invalidateQueries({ queryKey: mediaFolderDetailQueryKeys.detail(variables.folderId) });
      options?.onSuccess?.(data, variables, context);
    },
    ...options,
  });
};
