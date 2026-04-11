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
import { mediaFolderDetailQueryKeys } from "./media-folders/use-media-folder-detail"

export interface AssignedPerson {
  id: string
  first_name: string
  last_name: string
  email: string | null
}

export interface FolderPersonsResponse {
  folder_id: string
  persons: AssignedPerson[]
}

const FOLDER_PERSONS_QUERY_KEY = "folder_persons" as const
export const folderPersonsQueryKeys = queryKeysFactory(FOLDER_PERSONS_QUERY_KEY)

export const useFolderPersons = (
  folderId: string,
  options?: Omit<
    UseQueryOptions<FolderPersonsResponse, FetchError, FolderPersonsResponse, QueryKey>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () =>
      sdk.client.fetch<FolderPersonsResponse>(
        `/admin/medias/folders/${folderId}/assign-persons`,
        { method: "GET" }
      ),
    queryKey: folderPersonsQueryKeys.detail(folderId),
    ...options,
  })

  return {
    persons: data?.persons || [],
    ...rest,
  }
}

export interface AssignPersonsPayload {
  person_ids: string[]
}

export const useAssignPersonsToFolder = (
  folderId: string,
  options?: UseMutationOptions<
    { folder_id: string; person_ids: string[]; assigned: boolean },
    Error,
    AssignPersonsPayload
  >
) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload) => {
      return sdk.client.fetch<{ folder_id: string; person_ids: string[]; assigned: boolean }>(
        `/admin/medias/folders/${folderId}/assign-persons`,
        {
          method: "POST",
          body: payload,
        }
      )
    },
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: folderPersonsQueryKeys.detail(folderId) })
      queryClient.invalidateQueries({ queryKey: mediaFolderDetailQueryKeys.detail(folderId) })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useUnassignPersonsFromFolder = (
  folderId: string,
  options?: UseMutationOptions<
    { folder_id: string; person_ids: string[]; assigned: boolean },
    Error,
    AssignPersonsPayload
  >
) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload) => {
      return sdk.client.fetch<{ folder_id: string; person_ids: string[]; assigned: boolean }>(
        `/admin/medias/folders/${folderId}/assign-persons`,
        {
          method: "DELETE",
          body: payload,
        }
      )
    },
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: folderPersonsQueryKeys.detail(folderId) })
      queryClient.invalidateQueries({ queryKey: mediaFolderDetailQueryKeys.detail(folderId) })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}
