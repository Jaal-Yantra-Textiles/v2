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

export interface ViewConfiguration {
  id: string
  entity: string
  name: string | null
  user_id: string | null
  is_system_default: boolean
  configuration: {
    visible_columns?: string[]
    column_order?: string[]
    filters?: Record<string, any>
    sorting?: { id: string; desc: boolean } | null
    search?: string
  }
  created_at: string
  updated_at: string
}

export interface ViewConfigurationsResponse {
  view_configurations: ViewConfiguration[]
}

export interface ViewConfigurationResponse {
  view_configuration: ViewConfiguration | null
}

const VIEW_CONFIG_KEY = "view_configurations" as const
const baseKeys = queryKeysFactory(VIEW_CONFIG_KEY)

export const viewQueryKeys = {
  ...baseKeys,
  list: (entity: string) => [VIEW_CONFIG_KEY, "list", entity] as const,
  active: (entity: string) => [VIEW_CONFIG_KEY, "active", entity] as const,
  detail: (entity: string, id: string) => [VIEW_CONFIG_KEY, "detail", entity, id] as const,
}

export const useViewConfigurations = (
  entity: string,
  options?: Omit<
    UseQueryOptions<ViewConfigurationsResponse, FetchError, ViewConfigurationsResponse, QueryKey>,
    "queryKey" | "queryFn"
  >,
) => {
  return useQuery({
    queryKey: viewQueryKeys.list(entity),
    queryFn: async () =>
      sdk.client.fetch<ViewConfigurationsResponse>(`/admin/views/${entity}/configurations`, {
        method: "GET",
      }),
    ...options,
  })
}

export const useActiveViewConfiguration = (
  entity: string,
  options?: Omit<
    UseQueryOptions<ViewConfigurationResponse, FetchError, ViewConfigurationResponse, QueryKey>,
    "queryKey" | "queryFn"
  >,
) => {
  return useQuery({
    queryKey: viewQueryKeys.active(entity),
    queryFn: async () =>
      sdk.client.fetch<ViewConfigurationResponse>(`/admin/views/${entity}/configurations/active`, {
        method: "GET",
      }),
    ...options,
  })
}

export interface CreateViewConfigurationPayload {
  name?: string | null
  is_system_default?: boolean
  set_active?: boolean
  configuration: ViewConfiguration["configuration"]
}

export const useCreateViewConfiguration = (
  entity: string,
  options?: UseMutationOptions<ViewConfigurationResponse, FetchError, CreateViewConfigurationPayload>,
) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: CreateViewConfigurationPayload) =>
      sdk.client.fetch<ViewConfigurationResponse>(`/admin/views/${entity}/configurations`, {
        method: "POST",
        body: payload,
      }),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: viewQueryKeys.list(entity) })
      queryClient.invalidateQueries({ queryKey: viewQueryKeys.active(entity) })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export interface UpdateViewConfigurationPayload {
  id: string
  configuration: ViewConfiguration["configuration"]
  name?: string | null
  set_active?: boolean
}

export const useUpdateViewConfiguration = (
  entity: string,
  options?: UseMutationOptions<ViewConfigurationResponse, FetchError, UpdateViewConfigurationPayload>,
) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...payload }: UpdateViewConfigurationPayload) =>
      sdk.client.fetch<ViewConfigurationResponse>(
        `/admin/views/${entity}/configurations/${id}`,
        {
          method: "POST",
          body: payload,
        },
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: viewQueryKeys.list(entity) })
      queryClient.invalidateQueries({ queryKey: viewQueryKeys.active(entity) })
      queryClient.invalidateQueries({
        queryKey: viewQueryKeys.detail(entity, variables.id),
      })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useDeleteViewConfiguration = (
  entity: string,
  options?: UseMutationOptions<{ success: boolean }, FetchError, string>,
) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) =>
      sdk.client.fetch<{ success: boolean }>(`/admin/views/${entity}/configurations/${id}`, {
        method: "DELETE",
      }),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: viewQueryKeys.list(entity) })
      queryClient.invalidateQueries({ queryKey: viewQueryKeys.active(entity) })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useSetActiveViewConfiguration = (
  entity: string,
  options?: UseMutationOptions<ViewConfigurationResponse, FetchError, string | null>,
) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (viewConfigurationId: string | null) =>
      sdk.client.fetch<ViewConfigurationResponse>(`/admin/views/${entity}/configurations/active`, {
        method: "POST",
        body: {
          view_configuration_id: viewConfigurationId,
        },
      }),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: viewQueryKeys.list(entity) })
      queryClient.invalidateQueries({ queryKey: viewQueryKeys.active(entity) })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}
