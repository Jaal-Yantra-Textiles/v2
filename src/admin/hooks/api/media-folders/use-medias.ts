import { useQuery, UseQueryOptions } from "@tanstack/react-query";
import { FetchError } from "@medusajs/js-sdk";
import { sdk } from "../../../lib/config";
import { queryKeysFactory } from "../../../lib/query-key-factory";

/**
 * File type enum matching the MediaFile model
 */
export type FileType = "image" | "video" | "audio" | "document" | "archive" | "other";

/**
 * Filter options for media queries
 */
export type MediasFilters = {
  /** Filter by file type */
  file_type?: FileType;
  /** Filter by public/private status */
  is_public?: boolean;
  /** Filter by parent folder ID */
  parent_folder_id?: string;
  /** Search query string */
  q?: string;
  /** Additional filters */
  [key: string]: any;
};

export type MediasQuery = {
  skip?: number;
  take?: number;
  /** Filter options for media queries */
  filters?: MediasFilters;
  config?: {
    select?: string[];
    relations?: string[];
  };
};

export type MediasResponse = {
  folders: any[];
  folders_count: number;
  albums: any[];
  albums_count: number;
  media_files: any[];
  media_files_count: number;
  album_media: any[];
  album_media_count: number;
};

const MEDIAS_QUERY_KEY = "medias" as const;
export const mediasQueryKeys = queryKeysFactory(MEDIAS_QUERY_KEY);

export const useMedias = (
  query?: MediasQuery,
  options?: Omit<
    UseQueryOptions<MediasResponse, FetchError, MediasResponse, any>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () =>
      sdk.client.fetch<MediasResponse>(`/admin/medias`, {
        method: "GET",
        query: query,
      }),
    queryKey: mediasQueryKeys.list(query),
    ...options,
  });

  return {
    medias: data,
    folders: data?.folders ?? [],
    folders_count: data?.folders_count ?? 0,
    albums: data?.albums ?? [],
    albums_count: data?.albums_count ?? 0,
    media_files: data?.media_files ?? [],
    media_files_count: data?.media_files_count ?? 0,
    album_media: data?.album_media ?? [],
    album_media_count: data?.album_media_count ?? 0,
    ...rest,
  };
};
