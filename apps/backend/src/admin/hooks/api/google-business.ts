import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { sdk } from "../../lib/config"

export type GoogleService = "merchant" | "ads" | "search-console" | "business-profile"

export type AccessibleResource = {
  resource_id: string
  resource_label: string
  metadata: Record<string, any>
}

export type GoogleBinding = {
  id: string
  platform_id: string
  service: GoogleService
  resource_id: string
  resource_label: string | null
  status: "active" | "paused" | "error" | "pending"
  last_synced_at: string | null
  last_error: string | null
  settings: Record<string, any> | null
  metadata: Record<string, any> | null
  created_at: string
  updated_at: string
}

export type GoogleInitOauthResponse = {
  location: string
  state: string
}

export type GoogleRefreshResponse = {
  platform_id: string
  access_token: string
  expires_at: string | null
  refreshed: boolean
}

const KEYS = {
  all: ["google-business"] as const,
  bindings: (platformId: string, service?: GoogleService) =>
    [...KEYS.all, "bindings", platformId, service ?? "all"] as const,
  resources: (platformId: string, service: GoogleService) =>
    [...KEYS.all, "accessible-resources", platformId, service] as const,
}

export function useInitiateGoogleConnect(platformId: string) {
  return useMutation({
    mutationFn: async (input: { services: GoogleService[]; loginHint?: string }) => {
      const response = await sdk.client.fetch<GoogleInitOauthResponse>(
        `/admin/social-platforms/${platformId}/google/oauth-init`,
        {
          method: "POST",
          body: { services: input.services, login_hint: input.loginHint },
        }
      )
      localStorage.setItem("oauth_platform_id", platformId)
      localStorage.setItem("oauth_platform_kind", "google")
      window.location.href = response.location
      return response
    },
  })
}

export function useRefreshGoogleToken(platformId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (force?: boolean) =>
      sdk.client.fetch<GoogleRefreshResponse>(
        `/admin/social-platforms/${platformId}/google/refresh-token`,
        { method: "POST", body: { force: !!force } }
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["social-platforms"] })
      qc.invalidateQueries({ queryKey: KEYS.all })
    },
  })
}

export function useGoogleAccessibleResources(
  platformId: string,
  service: GoogleService | null,
  enabled = true
) {
  const query = useQuery({
    queryKey: KEYS.resources(platformId, service as GoogleService),
    queryFn: () =>
      sdk.client.fetch<{ service: GoogleService; resources: AccessibleResource[] }>(
        `/admin/social-platforms/${platformId}/google/accessible-resources/${service}`,
        { method: "GET" }
      ),
    enabled: enabled && !!service && !!platformId,
  })
  return {
    resources: query.data?.resources || [],
    ...query,
  }
}

export function useGoogleBindings(platformId: string, service?: GoogleService) {
  const query = useQuery({
    queryKey: KEYS.bindings(platformId, service),
    queryFn: () =>
      sdk.client.fetch<{ bindings: GoogleBinding[]; count: number }>(
        `/admin/social-platforms/${platformId}/google/bindings`,
        { method: "GET", query: service ? { service } : undefined }
      ),
    enabled: !!platformId,
  })
  return {
    bindings: query.data?.bindings || [],
    count: query.data?.count || 0,
    ...query,
  }
}

export function useUpsertGoogleBinding(platformId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: {
      service: GoogleService
      resource_id: string
      resource_label?: string | null
      settings?: Record<string, any> | null
      metadata?: Record<string, any> | null
    }) =>
      sdk.client.fetch<{ binding: GoogleBinding }>(
        `/admin/social-platforms/${platformId}/google/bindings`,
        { method: "POST", body }
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.all })
    },
  })
}

export function useDeleteGoogleBinding(platformId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (bindingId: string) =>
      sdk.client.fetch<{ id: string; deleted: boolean }>(
        `/admin/social-platforms/${platformId}/google/bindings/${bindingId}`,
        { method: "DELETE" }
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.all })
    },
  })
}
