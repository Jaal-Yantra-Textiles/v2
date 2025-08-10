import { useQuery, UseQueryOptions } from "@tanstack/react-query";
import { FetchError } from "@medusajs/js-sdk";
import { AdminMediaFolder } from "../media-folders";
import { queryKeysFactory } from "../../../lib/query-key-factory";
import { sdk } from "../../../lib/config";

const MEDIA_FOLDER_QUERY_KEY = "media_folder" as const;
export const mediaFolderQueryKeys = queryKeysFactory(MEDIA_FOLDER_QUERY_KEY);

export interface AdminGetMediaFolderQuery {
  expand?: string;
}

export const useMediaFolder = (
  id: string,
  query?: AdminGetMediaFolderQuery,
  options?: Omit<
    UseQueryOptions<
      { folder: AdminMediaFolder },
      FetchError,
      { folder: AdminMediaFolder },
      any
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () =>
      sdk.client.fetch<{ folder: AdminMediaFolder }>(
        `/admin/medias/folder/${id}`,
        {
          method: "GET",
          query,
        }
      ),
    queryKey: mediaFolderQueryKeys.detail(id, query),
    ...options,
  });
  
  return { 
    folder: data?.folder, 
    ...rest 
  };
};
