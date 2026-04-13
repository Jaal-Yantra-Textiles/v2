import { FetchError } from "@medusajs/js-sdk"
import {
  QueryKey,
  UseMutationOptions,
  UseQueryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { sdk } from "../../lib/config"
import { queryKeysFactory } from "../../lib/query-key-factory"

export interface MediaComment {
  id: string
  content: string
  author_type: "partner" | "admin"
  author_id: string
  author_name: string
  media_file_id: string
  metadata: Record<string, any> | null
  created_at?: string
  updated_at?: string
}

const MEDIA_COMMENTS_QUERY_KEY = "media_comments" as const
export const mediaCommentsQueryKeys = queryKeysFactory(MEDIA_COMMENTS_QUERY_KEY)

export const useMediaComments = (
  mediaId: string,
  options?: Omit<
    UseQueryOptions<{ comments: MediaComment[] }, FetchError, { comments: MediaComment[] }, QueryKey>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () =>
      sdk.client.fetch<{ comments: MediaComment[] }>(
        `/admin/medias/${mediaId}/comments`,
        { method: "GET" }
      ),
    queryKey: mediaCommentsQueryKeys.detail(mediaId),
    ...options,
  })

  return {
    comments: data?.comments || [],
    ...rest,
  }
}

export interface CreateMediaCommentPayload {
  content: string
}

export const useCreateMediaComment = (
  mediaId: string,
  options?: UseMutationOptions<{ comment: MediaComment }, Error, CreateMediaCommentPayload>
) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload) => {
      return sdk.client.fetch<{ comment: MediaComment }>(
        `/admin/medias/${mediaId}/comments`,
        {
          method: "POST",
          body: payload,
        }
      )
    },
    onSuccess: (data, variables, _mutateResult, context) => {
      queryClient.invalidateQueries({ queryKey: mediaCommentsQueryKeys.detail(mediaId) })
      options?.onSuccess?.(data, variables, _mutateResult, context)
    },
    ...options,
  })
}
