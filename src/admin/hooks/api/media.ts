import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import { sdk } from "../../lib/config";
import { queryKeysFactory } from "../../lib/query-key-factory";

// ============================================================================
// Types
// ============================================================================

export interface MediaFile {
  id: string;
  file_name: string;
  original_name?: string;
  file_path: string;
  file_type: string;
  mime_type: string;
  file_size: number;
  width?: number;
  height?: number;
  title?: string;
  description?: string;
  alt_text?: string;
  caption?: string;
  is_public: boolean;
  folder_id?: string;
  created_at: string;
  updated_at: string;
}

export interface MediaFolder {
  id: string;
  name: string;
  slug: string;
  description?: string;
  path: string;
  level: number;
  sort_order: number;
  is_public: boolean;
  parent_folder_id?: string;
  metadata?: Record<string, any>;
}

export interface MediaAlbum {
  id: string;
  name: string;
  description?: string;
  slug: string;
  is_public: boolean;
  sort_order: number;
  type: "gallery" | "portfolio" | "product" | "profile" | "general";
  metadata?: Record<string, any>;
}

export interface MediaFilesResponse {
  media_files: MediaFile[];
  media_files_count: number;
}

export interface FoldersResponse {
  folders: MediaFolder[];
  count: number;
}

export interface AlbumsResponse {
  albums: MediaAlbum[];
  count: number;
}

// ============================================================================
// Query Keys
// ============================================================================

const MEDIA_QUERY_KEY = "media" as const;
export const mediaQueryKeys = queryKeysFactory(MEDIA_QUERY_KEY);

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook to fetch media files with optional filters
 */
export interface UseMediaFilesQuery {
  folder_id?: string;
  album_id?: string;
  file_type?: string;
  search?: string;
  created_after?: string;
  created_before?: string;
  limit?: number;
}

export const useMediaFiles = (query: UseMediaFilesQuery = {}) => {
  const { limit = 20, ...filters } = query; // Reduced from 40 to 20 for better memory management

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, ...rest } = useInfiniteQuery({
    queryKey: mediaQueryKeys.list({ ...query }),
    queryFn: async ({ pageParam = 0 }) => {
      // Build filters object
      const apiFilters: Record<string, any> = {};
      
      if (filters.folder_id) apiFilters.folder_id = filters.folder_id;
      // Note: album_id filtering is currently not supported in the backend
      // because it requires querying through the AlbumMedia pivot table
      // TODO: Implement album filtering via a dedicated endpoint or query
      if (filters.file_type) apiFilters.file_type = filters.file_type;
      if (filters.search) apiFilters.q = filters.search;
      if (filters.created_after) apiFilters.created_at = { $gte: filters.created_after };
      if (filters.created_before) {
        apiFilters.created_at = {
          ...apiFilters.created_at,
          $lte: filters.created_before,
        };
      }

      return sdk.client.fetch<MediaFilesResponse>("/admin/medias", {
        method: "GET",
        query: {
          filters: JSON.stringify(apiFilters),
          skip: pageParam,
          take: limit,
        },
      });
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loadedCount = allPages.reduce((sum, page) => sum + (page.media_files?.length || 0), 0);
      const totalCount = lastPage.media_files_count || 0;
      return loadedCount < totalCount ? loadedCount : undefined;
    },
  });

  const files = data?.pages.flatMap((p) => p.media_files) ?? [];

  return {
    files,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    ...rest,
  };
};

/**
 * Hook to fetch all folders (for dropdown)
 */
export const useFolders = () => {
  return useQuery({
    queryKey: mediaQueryKeys.lists(),
    queryFn: async () => {
      return sdk.client.fetch<FoldersResponse>("/admin/medias/folders", {
        method: "GET",
      });
    },
  });
};

/**
 * Hook to fetch all albums (for dropdown)
 */
export const useAlbums = () => {
  return useQuery({
    queryKey: [...mediaQueryKeys.lists(), "albums"],
    queryFn: async () => {
      return sdk.client.fetch<AlbumsResponse>("/admin/medias/albums", {
        method: "GET",
      });
    },
  });
};

/**
 * Hook to fetch folder details with media files
 */
export const useFolderDetail = (folderId?: string) => {
  return useQuery({
    queryKey: [...mediaQueryKeys.detail(folderId || ""), "detail"],
    queryFn: async () => {
      if (!folderId) return null;
      return sdk.client.fetch<{ folder: MediaFolder; media_files: MediaFile[] }>(
        `/admin/medias/folder/${folderId}/detail`,
        { method: "GET" }
      );
    },
    enabled: !!folderId,
  });
};
