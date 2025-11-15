import { PaginatedResponse } from "@medusajs/types"
import { toast } from "@medusajs/ui"
import {
  QueryKey,
  UseMutationResult,
  UseQueryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { FetchError } from "@medusajs/js-sdk"

import { sdk } from "../../lib/config"
import { queryKeysFactory } from "../../lib/query-key-factory"

// Types
export type AdminSocialPost = {
  id: string
  name: string
  post_url: string | null
  caption: string | null
  status: "draft" | "scheduled" | "posted" | "failed" | "archived"
  scheduled_at: string | null
  posted_at: string | null
  insights: Record<string, any> | null
  media_attachments: Record<string, any> | null
  notes: string | null
  error_message: string | null
  related_item_type: string | null
  related_item_id: string | null
  metadata: Record<string, any> | null
  platform_id: string
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export type AdminSocialPostListResponse = PaginatedResponse<{
  socialPosts: AdminSocialPost[]
}>

export type AdminSocialPostResponse = {
  socialPost: AdminSocialPost
}

export type AdminCreateSocialPostPayload = {
  name: string
  caption?: string
  status?: "draft" | "scheduled" | "posted" | "failed" | "archived"
  platform_id: string
  scheduled_at?: string | null
  media_attachments?: Record<string, any> | null
  notes?: string | null
  metadata?: Record<string, any> | null
}

export type AdminUpdateSocialPostPayload = Partial<AdminCreateSocialPostPayload>

export const socialPostsQueryKeys = queryKeysFactory<
  "social_posts",
  AdminCreateSocialPostPayload | AdminUpdateSocialPostPayload
>("social_posts")

// Hooks
export const useSocialPosts = (
  query?: Record<string, any>,
  options?: Omit<
    UseQueryOptions<
      AdminSocialPostListResponse,
      FetchError,
      AdminSocialPostListResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: socialPostsQueryKeys.list(query),
    queryFn: async () =>
      sdk.client.fetch<AdminSocialPostListResponse>(
        `/admin/social-posts`,
        {
          method: "GET",
          query,
        }
      ),
    ...options,
  })

  return { ...data, ...rest }
}

export const useSocialPost = (id: string) => {
  const { data, ...rest } = useQuery({
    queryKey: socialPostsQueryKeys.detail(id),
    queryFn: async () =>
      sdk.client.fetch<AdminSocialPostResponse>(
        `/admin/social-posts/${id}`
      ),
  })
  return { ...data, ...rest }
}

export const useCreateSocialPost = (): UseMutationResult<
  AdminSocialPostResponse,
  Error,
  AdminCreateSocialPostPayload
> => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload) =>
      sdk.client.fetch(`/admin/social-posts`, {
        method: "POST",
        body: payload,
      }),
    onSuccess: () => {
      toast.success("Social post created successfully")
      queryClient.invalidateQueries({ queryKey: socialPostsQueryKeys.lists() })
    },
    onError: (error) => {
        toast.error(error.message)
    }
  })
}

// Publish a social post to configured platforms
// Uses the new standardized endpoint: POST /admin/social-posts/:id/publish
export const usePublishSocialPost = (): UseMutationResult<
  {
    success: boolean
    post: AdminSocialPost
    results: {
      facebook?: { platform: string; success: boolean; postId?: string; error?: string }
      instagram?: { platform: string; success: boolean; postId?: string; permalink?: string; error?: string }
    }
  },
  Error,
  { post_id: string; override_page_id?: string; override_ig_user_id?: string }
> => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ post_id, override_page_id, override_ig_user_id }) =>
      sdk.client.fetch(`/admin/social-posts/${post_id}/publish`, {
        method: "POST",
        body: { override_page_id, override_ig_user_id },
      }),
    onSuccess: (data) => {
      if (data.success) {
        toast.success("Post published successfully!")
      } else {
        toast.warning("Published with some errors. Check post details.")
      }
      queryClient.invalidateQueries({ queryKey: socialPostsQueryKeys.lists() })
      queryClient.invalidateQueries({ queryKey: socialPostsQueryKeys.all })
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })
}

// @deprecated Use usePublishSocialPost instead
// Kept for backward compatibility during migration
export const usePublishToBothPlatforms = (): UseMutationResult<
  {
    success: boolean
    post: AdminSocialPost
    results: {
      facebook?: { platform: string; success: boolean; postId?: string; error?: string }
      instagram?: { platform: string; success: boolean; postId?: string; permalink?: string; error?: string }
    }
  },
  Error,
  { post_id: string }
> => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload) =>
      sdk.client.fetch(`/admin/social-posts/${payload.post_id}/publish`, {
        method: "POST",
        body: {},
      }),
    onSuccess: (data) => {
      if (data.success) {
        toast.success("Post published successfully!")
      } else {
        toast.warning("Published with some errors. Check post details.")
      }
      queryClient.invalidateQueries({ queryKey: socialPostsQueryKeys.lists() })
      queryClient.invalidateQueries({ queryKey: socialPostsQueryKeys.all })
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })
}

export const useUpdateSocialPost = (
  id: string
): UseMutationResult<
  AdminSocialPostResponse,
  Error,
  AdminUpdateSocialPostPayload
> => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload) =>
      sdk.client.fetch(`/admin/social-posts/${id}`, {
        method: "PUT",
        body: payload,
      }),
    onSuccess: () => {
      toast.success("Social post updated successfully")
      queryClient.invalidateQueries({ queryKey: socialPostsQueryKeys.all })
    },
    onError: (error) => {
        toast.error(error.message)
    }
  })
}

export const useDeleteSocialPost = (
  id: string
): UseMutationResult<void, Error, void> => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () =>
      sdk.client.fetch(`/admin/social-posts/${id}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      toast.success("Social post deleted successfully")
      queryClient.invalidateQueries({ queryKey: socialPostsQueryKeys.all })
    },
    onError: (error) => {
        toast.error(error.message)
    }
  })
}

