import { FetchError } from "@medusajs/js-sdk"
import {
  QueryKey,
  UseMutationOptions,
  UseQueryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { sdk } from "../../lib/client/client"
import { queryKeysFactory } from "../../lib/query-key-factory"

// ── Types ──

export interface SharedFolderMediaFile {
  id: string
  file_name: string
  original_name: string
  file_path: string
  file_type: "image" | "video" | "audio" | "document" | "archive" | "other"
  mime_type: string
  file_size: number
  created_at?: string
}

export interface SharedFolderPerson {
  id: string
  first_name: string
  last_name: string
}

export interface SharedFolder {
  id: string
  name: string
  slug: string
  description: string | null
  path: string
  is_public: boolean
  media_files?: SharedFolderMediaFile[]
  assigned_persons?: SharedFolderPerson[]
}

export interface SharedFolderDetail extends SharedFolder {
  media_files: Array<
    SharedFolderMediaFile & {
      comments?: MediaComment[]
    }
  >
}

export interface MediaComment {
  id: string
  content: string
  author_type: "partner" | "admin"
  author_id: string
  author_name: string
  media_file_id: string
  created_at?: string
  updated_at?: string
}

// ── Query Keys ──

const SHARED_FOLDERS_QUERY_KEY = "partner-shared-folders"
export const sharedFoldersQueryKeys = queryKeysFactory(SHARED_FOLDERS_QUERY_KEY)

const SHARED_FOLDER_COMMENTS_QUERY_KEY = "partner-shared-folder-comments"
export const sharedFolderCommentsQueryKeys = queryKeysFactory(
  SHARED_FOLDER_COMMENTS_QUERY_KEY
)

// ── List shared folders ──

export const usePartnerSharedFolders = (
  options?: Omit<
    UseQueryOptions<
      { shared_folders: SharedFolder[] },
      FetchError,
      { shared_folders: SharedFolder[] },
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () =>
      sdk.client.fetch<{ shared_folders: SharedFolder[] }>(
        "/partners/shared-folders",
        { method: "GET" }
      ),
    queryKey: sharedFoldersQueryKeys.lists(),
    ...options,
  })

  return {
    shared_folders: data?.shared_folders || [],
    ...rest,
  }
}

// ── Get single shared folder detail ──

export const usePartnerSharedFolder = (
  folderId: string,
  options?: Omit<
    UseQueryOptions<
      { shared_folder: SharedFolderDetail },
      FetchError,
      { shared_folder: SharedFolderDetail },
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () =>
      sdk.client.fetch<{ shared_folder: SharedFolderDetail }>(
        `/partners/shared-folders/${folderId}`,
        { method: "GET" }
      ),
    queryKey: sharedFoldersQueryKeys.detail(folderId),
    enabled: !!folderId,
    ...options,
  })

  return {
    shared_folder: data?.shared_folder,
    ...rest,
  }
}

// ── Register uploaded file to shared folder ──

export interface RegisterUploadPayload {
  key: string
  url: string
  filename: string
  mimeType: string
  size: number
  metadata?: Record<string, any>
}

export const useRegisterSharedFolderUpload = (
  folderId: string,
  options?: UseMutationOptions<
    { message: string; media_file: any },
    Error,
    RegisterUploadPayload
  >
) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload) =>
      sdk.client.fetch<{ message: string; media_file: any }>(
        `/partners/shared-folders/${folderId}/upload`,
        { method: "POST", body: payload }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: sharedFoldersQueryKeys.detail(folderId),
      })
      queryClient.invalidateQueries({
        queryKey: sharedFoldersQueryKeys.lists(),
      })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

// ── List comments on a media file ──

export const useSharedFolderMediaComments = (
  folderId: string,
  mediaId: string,
  options?: Omit<
    UseQueryOptions<
      { comments: MediaComment[] },
      FetchError,
      { comments: MediaComment[] },
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () =>
      sdk.client.fetch<{ comments: MediaComment[] }>(
        `/partners/shared-folders/${folderId}/media/${mediaId}/comments`,
        { method: "GET" }
      ),
    queryKey: sharedFolderCommentsQueryKeys.detail(mediaId),
    enabled: !!folderId && !!mediaId,
    ...options,
  })

  return {
    comments: data?.comments || [],
    ...rest,
  }
}

// ── Add comment to a media file ──

export const useAddSharedFolderComment = (
  folderId: string,
  mediaId: string,
  options?: UseMutationOptions<
    { comment: MediaComment },
    Error,
    { content: string }
  >
) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload) =>
      sdk.client.fetch<{ comment: MediaComment }>(
        `/partners/shared-folders/${folderId}/media/${mediaId}/comments`,
        { method: "POST", body: payload }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: sharedFolderCommentsQueryKeys.detail(mediaId),
      })
      queryClient.invalidateQueries({
        queryKey: sharedFoldersQueryKeys.detail(folderId),
      })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}
