import { useInfiniteQuery } from "@tanstack/react-query";
import { sdk } from "../../lib/config";
import { queryKeysFactory } from "../../lib/query-key-factory";

export interface AdminEditorFile {
  id: string;
  url: string;
  filename?: string;
  mime_type?: string;
  metadata?: Record<string, any> | null;
  created_at?: string;
}

export interface AdminEditorFilesResponse {
  files: AdminEditorFile[];
  count: number;
  offset: number;
  limit: number;
}

const EDITOR_FILES_QUERY_KEY = "editor_files" as const;
export const editorFilesQueryKeys = queryKeysFactory(EDITOR_FILES_QUERY_KEY);

export interface UseEditorFilesQuery {
  limit?: number;
}

export const useEditorFiles = (query: { limit?: number } = {}) => {
  const { limit = 20 } = query

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, ...rest } = useInfiniteQuery({
    queryKey: editorFilesQueryKeys.list(query),
    queryFn: async ({ pageParam = 0 }) => {
      return sdk.client.fetch<AdminEditorFilesResponse>("/admin/editor-files", {
        method: "GET",
        query: { limit, offset: pageParam },
      })
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      const nextOffset = lastPage.offset + lastPage.files.length
      return nextOffset < lastPage.count ? nextOffset : undefined
    },
  })

  const files = data?.pages.flatMap((p) => p.files) ?? [];

  return {
    files,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    ...rest,
  }
};
