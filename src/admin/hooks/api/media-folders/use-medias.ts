import { useQuery, UseQueryOptions } from "@tanstack/react-query";
import { FetchError } from "@medusajs/js-sdk";
import { sdk } from "../../../lib/config";
import { queryKeysFactory } from "../../../lib/query-key-factory";

export type MediasQuery = {
  skip?: number;
  take?: number;
  // Optional JSON-serializable filter/config maps
  filters?: Record<string, any>;
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
