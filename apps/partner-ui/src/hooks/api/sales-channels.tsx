import { FetchError } from "@medusajs/js-sdk"
import {
  AdminSalesChannelListResponse,
  AdminSalesChannelResponse,
  HttpTypes,
} from "@medusajs/types"
import {
  QueryKey,
  UseMutationOptions,
  UseQueryOptions,
  useMutation,
  useQuery,
} from "@tanstack/react-query"
import { sdk } from "../../lib/client"
import { queryClient } from "../../lib/query-client"
import { queryKeysFactory } from "../../lib/query-key-factory"
import { productsQueryKeys } from "./products"
import { usePartnerStores } from "./partner-stores"

const SALES_CHANNELS_QUERY_KEY = "sales-channels" as const
export const salesChannelsQueryKeys = queryKeysFactory(SALES_CHANNELS_QUERY_KEY)

export const useSalesChannel = (
  id: string,
  options?: Omit<
    UseQueryOptions<
      { sales_channel: any },
      FetchError,
      { sales_channel: any },
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { stores } = usePartnerStores()
  const storeId = stores?.[0]?.id

  const { data, ...rest } = useQuery({
    queryKey: salesChannelsQueryKeys.detail(id),
    queryFn: async () =>
      sdk.client.fetch<{ sales_channel: any }>(
        `/partners/stores/${storeId}/sales-channels/${id}`,
        { method: "GET" }
      ),
    enabled: !!storeId && (options?.enabled !== false),
    ...options,
  })

  return { ...data, ...rest }
}

export const useSalesChannels = (
  query?: HttpTypes.AdminSalesChannelListParams,
  options?: Omit<
    UseQueryOptions<
      { sales_channels: any[]; count: number },
      FetchError,
      { sales_channels: any[]; count: number },
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { stores } = usePartnerStores()
  const storeId = stores?.[0]?.id

  const { data, ...rest } = useQuery({
    queryFn: () =>
      sdk.client.fetch<{ sales_channels: any[]; count: number }>(
        `/partners/stores/${storeId}/sales-channels`,
        { method: "GET" }
      ),
    queryKey: salesChannelsQueryKeys.list(query),
    enabled: !!storeId && (options?.enabled !== false),
    ...options,
  })

  return { ...data, ...rest }
}

export const useCreateSalesChannel = (
  options?: UseMutationOptions<
    { sales_channel: any },
    FetchError,
    HttpTypes.AdminCreateSalesChannel
  >
) => {
  const { stores } = usePartnerStores()
  const storeId = stores?.[0]?.id

  return useMutation({
    mutationFn: (payload) =>
      sdk.client.fetch<{ sales_channel: any }>(
        `/partners/stores/${storeId}/sales-channels`,
        { method: "POST", body: payload }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: salesChannelsQueryKeys.lists(),
      })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useUpdateSalesChannel = (
  id: string,
  options?: UseMutationOptions<
    { sales_channel: any },
    FetchError,
    HttpTypes.AdminUpdateSalesChannel
  >
) => {
  const { stores } = usePartnerStores()
  const storeId = stores?.[0]?.id

  return useMutation({
    mutationFn: (payload) =>
      sdk.client.fetch<{ sales_channel: any }>(
        `/partners/stores/${storeId}/sales-channels/${id}`,
        { method: "POST", body: payload }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: salesChannelsQueryKeys.lists(),
      })
      queryClient.invalidateQueries({
        queryKey: salesChannelsQueryKeys.detail(id),
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useDeleteSalesChannel = (
  id: string,
  options?: UseMutationOptions<
    { id: string; object: string; deleted: boolean },
    FetchError,
    void
  >
) => {
  const { stores } = usePartnerStores()
  const storeId = stores?.[0]?.id

  return useMutation({
    mutationFn: () =>
      sdk.client.fetch<{ id: string; object: string; deleted: boolean }>(
        `/partners/stores/${storeId}/sales-channels/${id}`,
        { method: "DELETE" }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: salesChannelsQueryKeys.lists(),
      })
      queryClient.invalidateQueries({
        queryKey: salesChannelsQueryKeys.detail(id),
      })

      queryClient.invalidateQueries({
        queryKey: productsQueryKeys.all,
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useDeleteSalesChannelLazy = (
  options?: UseMutationOptions<
    { id: string; object: string; deleted: boolean },
    FetchError,
    string
  >
) => {
  const { stores } = usePartnerStores()
  const storeId = stores?.[0]?.id

  return useMutation({
    mutationFn: (id: string) =>
      sdk.client.fetch<{ id: string; object: string; deleted: boolean }>(
        `/partners/stores/${storeId}/sales-channels/${id}`,
        { method: "DELETE" }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: salesChannelsQueryKeys.lists(),
      })
      queryClient.invalidateQueries({
        queryKey: salesChannelsQueryKeys.detail(variables),
      })

      queryClient.invalidateQueries({
        queryKey: productsQueryKeys.all,
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useSalesChannelRemoveProducts = (
  id: string,
  options?: UseMutationOptions<
    AdminSalesChannelResponse,
    FetchError,
    HttpTypes.AdminBatchLink["remove"]
  >
) => {
  return useMutation({
    mutationFn: (payload) =>
      sdk.admin.salesChannel.batchProducts(id, { remove: payload }),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: salesChannelsQueryKeys.lists(),
      })
      queryClient.invalidateQueries({
        queryKey: salesChannelsQueryKeys.detail(id),
      })

      for (const product of variables || []) {
        queryClient.invalidateQueries({
          queryKey: productsQueryKeys.detail(product),
        })
      }

      queryClient.invalidateQueries({
        queryKey: productsQueryKeys.lists(),
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useSalesChannelAddProducts = (
  id: string,
  options?: UseMutationOptions<
    AdminSalesChannelResponse,
    FetchError,
    HttpTypes.AdminBatchLink["add"]
  >
) => {
  return useMutation({
    mutationFn: (payload) =>
      sdk.admin.salesChannel.batchProducts(id, { add: payload }),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: salesChannelsQueryKeys.lists(),
      })
      queryClient.invalidateQueries({
        queryKey: salesChannelsQueryKeys.detail(id),
      })

      for (const product of variables || []) {
        queryClient.invalidateQueries({
          queryKey: productsQueryKeys.detail(product),
        })
      }

      queryClient.invalidateQueries({
        queryKey: productsQueryKeys.lists(),
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}
