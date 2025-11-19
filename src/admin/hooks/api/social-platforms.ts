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
export type ApiCategory = 
  | "social" 
  | "payment" 
  | "shipping" 
  | "email" 
  | "sms" 
  | "analytics" 
  | "crm" 
  | "storage" 
  | "communication" 
  | "authentication" 
  | "other"

export type AuthType = 
  | "oauth2" 
  | "oauth1" 
  | "api_key" 
  | "bearer" 
  | "basic"

export type PlatformStatus = 
  | "active" 
  | "inactive" 
  | "error" 
  | "pending"

export type AdminSocialPlatform = {
  id: string
  name: string
  category: ApiCategory
  auth_type: AuthType
  icon_url: string | null
  base_url: string | null
  description: string | null
  api_config: Record<string, any> | null
  status: PlatformStatus
  metadata: Record<string, any> | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export type AdminSocialPlatformListResponse = PaginatedResponse<{
  socialPlatforms: AdminSocialPlatform[]
}>

export type AdminSocialPlatformResponse = {
  socialPlatform: AdminSocialPlatform
}

export type AdminCreateSocialPlatformPayload = {
  name: string
  category?: ApiCategory
  auth_type?: AuthType
  icon_url?: string
  base_url?: string
  description?: string
  status?: PlatformStatus
  metadata?: Record<string, any>
}

export type AdminUpdateSocialPlatformPayload = {
  name?: string
  category?: ApiCategory
  auth_type?: AuthType
  icon_url?: string
  base_url?: string
  description?: string
  status?: PlatformStatus
  api_config?: Record<string, any>
  metadata?: Record<string, any>
}

export const socialPlatformsQueryKeys = queryKeysFactory<
  "social_platforms",
  AdminCreateSocialPlatformPayload | AdminUpdateSocialPlatformPayload
>("social_platforms")

// Hooks
export const useSocialPlatforms = (
  query?: Record<string, any>,
  options?: Omit<
    UseQueryOptions<
      AdminSocialPlatformListResponse,
      FetchError,
      AdminSocialPlatformListResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: socialPlatformsQueryKeys.list(query),
    queryFn: async () =>
      sdk.client.fetch<AdminSocialPlatformListResponse>(
        `/admin/social-platforms`,
        {
          method: "GET",
          query,
        }
      ),
    ...options,
  })

  return { ...data, ...rest }
}

export const useSocialPlatform = (
  id: string,
  options?: Omit<
    UseQueryOptions<
      AdminSocialPlatformResponse,
      Error,
      AdminSocialPlatformResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: socialPlatformsQueryKeys.detail(id),
    queryFn: async () =>
      sdk.client.fetch<AdminSocialPlatformResponse>(
        `/admin/social-platforms/${id}`
      ),
    ...options,
  })
  return { ...data, ...rest }
}

export const useCreateSocialPlatform = (): UseMutationResult<
  AdminSocialPlatformResponse,
  Error,
  AdminCreateSocialPlatformPayload
> => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload) =>
      sdk.client.fetch(`/admin/social-platforms`, {
        method: "POST",
        body: payload,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: socialPlatformsQueryKeys.lists() })
    },
  })
}

export const useUpdateSocialPlatform = (
  id: string
): UseMutationResult<
  AdminSocialPlatformResponse,
  Error,
  AdminUpdateSocialPlatformPayload
> => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload) =>
      sdk.client.fetch(`/admin/social-platforms/${id}`, {
        method: "PUT",
        body: payload,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: socialPlatformsQueryKeys.all })
    },
  })
}

// Initiate OAuth login and open provider window
export const useInitiateSocialPlatformOAuth = () => {
  type OAuthResponse = { location: string; state?: string } | { token: string; expiresAt: number }

  return useMutation<OAuthResponse, Error, { platform: string; id: string; flow?: string }>({
    mutationFn: async ({ platform, id, flow }) => {
      const params = new URLSearchParams()
      if (flow) params.append("flow", flow)
      if (id) params.append("platform_id", id)
      const queryString = params.toString()
      
      return sdk.client.fetch<{ location: string; state?: string }>(`/admin/oauth/${platform}${queryString ? `?${queryString}` : ""}`, {
        method: "GET",
        credentials: "include",
      });
    },
    onSuccess: (data, variables) => {
      if ((data as any).location) {
        const { location, state } = data as { location: string; state?: string }
        if (state) {
          localStorage.setItem("oauth_state", state)
          localStorage.setItem("oauth_platform_id", variables.id || "")
        }
        window.location.href = location
      } else if ((data as any).token) {
        toast.success("App-only token acquired ✔")
      } else {
        toast.error("Unexpected response from provider.")
      }
    },
    onError: (error) => {
      toast.error(error.message || "Failed mutate: initiateOAuth flow.");
    }
  });
};

export const useDeleteSocialPlatform = (
  id: string
): UseMutationResult<void, Error, void> => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () =>
      sdk.client.fetch(`/admin/social-platforms/${id}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: socialPlatformsQueryKeys.all })
    },
  })
}
