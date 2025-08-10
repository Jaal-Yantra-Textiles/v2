import { FetchError } from "@medusajs/js-sdk";
import { PaginatedResponse } from "@medusajs/types";
import { QueryKey, UseQueryOptions, UseMutationOptions, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { sdk } from "../../lib/config";
import { mediasQueryKeys } from "./media-folders/use-medias";
import { queryKeysFactory } from "../../lib/query-key-factory";

export interface MediaFile {
  id: string;
  file_name: string;
  original_name: string;
  file_path: string;
  file_size: number;
  file_hash: string | null;
  file_type: "image" | "video" | "audio" | "document" | "archive" | "other";
  mime_type: string;
  extension: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  title: string | null;
  description: string | null;
  alt_text: string | null;
  caption: string | null;
  folder_path: string;
  tags: Record<string, any> | null;
  is_public: boolean;
  metadata: Record<string, any> | null;
  url: string;
  // Core fields that are automatically included by Medusa
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
}

export interface AdminMediaFolder {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  path: string;
  level: number;
  sort_order: number;
  is_public: boolean;
  metadata: Record<string, any> | null;
  parent_folder_id: string | null;
  parent_folder?: AdminMediaFolder | null;
  child_folders?: AdminMediaFolder[];
  media_files?: MediaFile[];
  // Core fields that are automatically included by Medusa
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
}

export interface AdminMediaFoldersResponse {
  folders: AdminMediaFolder[];
  count: number;
  offset: number;
  limit: number;
}

export interface AdminMediaFoldersQuery {
  offset?: number;
  limit?: number;
  q?: string;
  name?: string;
  slug?: string;
  is_public?: boolean;
  parent_folder_id?: string;
  order?: 'ASC' | 'DESC';
}

const MEDIA_FOLDERS_QUERY_KEY = "media_folders" as const;
export const mediaFoldersQueryKeys = queryKeysFactory(MEDIA_FOLDERS_QUERY_KEY);

export const useMediaFolders = (
  query?: AdminMediaFoldersQuery,
  options?: Omit<
    UseQueryOptions<
      PaginatedResponse<AdminMediaFoldersResponse>,
      FetchError,
      PaginatedResponse<AdminMediaFoldersResponse>,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >,
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () =>
      sdk.client.fetch<PaginatedResponse<AdminMediaFoldersResponse>>(
        `/admin/medias/folder`,
        {
          method: "GET",
          query,
        },
      ),
    queryKey: mediaFoldersQueryKeys.list(query),
    ...options,
  });
  
  return { 
    folders: data?.folders || [], 
    count: data?.count || 0,
    offset: query?.offset || 0,
    limit: query?.limit || 20,
    ...rest 
  };
};

// Create Media Folder Hook
export interface AdminCreateMediaFolderPayload {
  name: string;
  description?: string;
  is_public?: boolean;
  parent_folder_id?: string | null;
}

export const useCreateMediaFolder = (
  options?: UseMutationOptions<
    { folder: AdminMediaFolder },
    Error,
    AdminCreateMediaFolderPayload
  >
) => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (payload) => {
      const response = await sdk.client.fetch<{ folder: AdminMediaFolder }>(
        "/admin/medias/folder",
        {
          method: "POST",
          body: payload,
        }
      );
      return response;
    },
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: mediaFoldersQueryKeys.all });
      // Refresh dictionaries used by Selects (folders, albums)
      queryClient.invalidateQueries({ queryKey: ["media-dictionaries"] });
      // Refresh any generic media folders lists/hooks under media-folders/ directory hooks
      queryClient.invalidateQueries({ queryKey: ["media-folders", "list"] });
      // Refresh combined medias page (folders, albums, files)
      queryClient.invalidateQueries({ queryKey: mediasQueryKeys.all });
      options?.onSuccess?.(data, variables, context);
    },
    ...options,
  });
};

export const useDeleteMediaFolder = (
  id: string,
  options?: UseMutationOptions<
    void,
    Error,
    void
  >
) => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async () => {
      await sdk.client.fetch(
        `/admin/medias/folder/${id}`,
        {
          method: "DELETE",
        }
      );
    },
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: mediaFoldersQueryKeys.all });
      options?.onSuccess?.(data, variables, context);
    },
    ...options,
  });
};
