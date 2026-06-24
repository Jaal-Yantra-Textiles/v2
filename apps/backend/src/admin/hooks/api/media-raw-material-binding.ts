import {
  useMutation,
  useQuery,
  useQueryClient,
  UseMutationOptions,
  UseQueryOptions,
} from "@tanstack/react-query"
import { FetchError } from "@medusajs/js-sdk"
import { sdk } from "../../lib/config"

/**
 * Hooks for the manual photo → raw-material binding tool (#730).
 * Talks to /admin/medias/file/:id/raw-material (GET/POST/DELETE).
 */

export type MediaBinding = {
  raw_material_id: string
  raw_material_name: string | null
  sku: string | null
}

export type MediaBindingResponse = {
  media_file_id: string
  media_url: string
  binding: MediaBinding | null
}

export type BindRawMaterialPayload = {
  raw_material_id?: string
  media_url?: string
  sku?: string
  inventory_item_id?: string
  create?: { name: string; composition?: string; sku?: string }
}

export type BindRawMaterialResponse = {
  bound: boolean
  media_file_id: string
  media_url: string
  raw_material_id: string
  raw_material: Record<string, any>
  inventory_item_id: string | null
  sku: string | null
}

const bindingQueryKey = (mediaId: string) => [
  "media-raw-material-binding",
  mediaId,
]

export const useMediaRawMaterialBinding = (
  mediaId?: string,
  options?: Omit<
    UseQueryOptions<MediaBindingResponse, FetchError>,
    "queryKey" | "queryFn"
  >
) => {
  return useQuery<MediaBindingResponse, FetchError>({
    queryKey: bindingQueryKey(mediaId || "none"),
    queryFn: async () =>
      sdk.client.fetch<MediaBindingResponse>(
        `/admin/medias/file/${mediaId}/raw-material`,
        { method: "GET" }
      ),
    enabled: !!mediaId,
    ...options,
  })
}

export const useBindMediaRawMaterial = (
  mediaId: string,
  options?: UseMutationOptions<
    BindRawMaterialResponse,
    FetchError,
    BindRawMaterialPayload
  >
) => {
  const queryClient = useQueryClient()
  return useMutation<BindRawMaterialResponse, FetchError, BindRawMaterialPayload>({
    mutationFn: async (payload) =>
      sdk.client.fetch<BindRawMaterialResponse>(
        `/admin/medias/file/${mediaId}/raw-material`,
        { method: "POST", body: payload }
      ),
    onSuccess: (...args) => {
      queryClient.invalidateQueries({ queryKey: bindingQueryKey(mediaId) })
      queryClient.invalidateQueries({
        queryKey: ["inventory_items_raw_materials"],
      })
      options?.onSuccess?.(...args)
    },
    ...options,
  })
}

export const useUnbindMediaRawMaterial = (
  mediaId: string,
  options?: UseMutationOptions<
    { unbound: boolean },
    FetchError,
    { raw_material_id: string; media_url?: string }
  >
) => {
  const queryClient = useQueryClient()
  return useMutation<
    { unbound: boolean },
    FetchError,
    { raw_material_id: string; media_url?: string }
  >({
    mutationFn: async (payload) =>
      sdk.client.fetch<{ unbound: boolean }>(
        `/admin/medias/file/${mediaId}/raw-material`,
        { method: "DELETE", body: payload }
      ),
    onSuccess: (...args) => {
      queryClient.invalidateQueries({ queryKey: bindingQueryKey(mediaId) })
      queryClient.invalidateQueries({
        queryKey: ["inventory_items_raw_materials"],
      })
      options?.onSuccess?.(...args)
    },
    ...options,
  })
}
