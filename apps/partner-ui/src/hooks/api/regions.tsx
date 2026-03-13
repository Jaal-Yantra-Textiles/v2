import { HttpTypes, PaginatedResponse } from "@medusajs/types"
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
import { pricePreferencesQueryKeys } from "./price-preferences"
import { FetchError } from "@medusajs/js-sdk"
import { usePartnerStores } from "./partner-stores"

const REGIONS_QUERY_KEY = "regions" as const
export const regionsQueryKeys = queryKeysFactory(REGIONS_QUERY_KEY)

export const useRegion = (
  id: string,
  query?: Record<string, any>,
  options?: Omit<
    UseQueryOptions<
      { region: HttpTypes.AdminRegion },
      FetchError,
      { region: HttpTypes.AdminRegion },
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { stores } = usePartnerStores()
  const storeId = stores?.[0]?.id

  const { data, ...rest } = useQuery({
    queryKey: regionsQueryKeys.detail(id, query),
    queryFn: async () =>
      sdk.client.fetch<{ region: HttpTypes.AdminRegion }>(
        `/partners/stores/${storeId}/regions/${id}`,
        { method: "GET" }
      ),
    enabled: !!storeId && (options?.enabled !== false),
    ...options,
  })

  return { ...data, ...rest }
}

export const useRegions = (
  query?: Record<string, any>,
  options?: Omit<
    UseQueryOptions<
      PaginatedResponse<{ regions: HttpTypes.AdminRegion[] }>,
      FetchError,
      PaginatedResponse<{ regions: HttpTypes.AdminRegion[] }>,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { stores } = usePartnerStores()
  const storeId = stores?.[0]?.id

  const { data, ...rest } = useQuery({
    queryFn: () =>
      sdk.client.fetch<PaginatedResponse<{ regions: HttpTypes.AdminRegion[] }>>(
        `/partners/stores/${storeId}/regions`,
        { method: "GET" }
      ),
    queryKey: regionsQueryKeys.list(query),
    enabled: !!storeId && (options?.enabled !== false),
    ...options,
  })

  return { ...data, ...rest }
}

export const useCreateRegion = (
  options?: UseMutationOptions<
    { region: HttpTypes.AdminRegion },
    FetchError,
    HttpTypes.AdminCreateRegion
  >
) => {
  const { stores } = usePartnerStores()
  const storeId = stores?.[0]?.id

  return useMutation({
    mutationFn: (payload) =>
      sdk.client.fetch<{ region: HttpTypes.AdminRegion }>(
        `/partners/stores/${storeId}/regions`,
        { method: "POST", body: payload }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: regionsQueryKeys.lists() })

      queryClient.invalidateQueries({
        queryKey: pricePreferencesQueryKeys.list(),
      })
      queryClient.invalidateQueries({
        queryKey: pricePreferencesQueryKeys.details(),
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useUpdateRegion = (
  id: string,
  options?: UseMutationOptions<
    { region: HttpTypes.AdminRegion },
    FetchError,
    HttpTypes.AdminUpdateRegion
  >
) => {
  const { stores } = usePartnerStores()
  const storeId = stores?.[0]?.id

  return useMutation({
    mutationFn: (payload) =>
      sdk.client.fetch<{ region: HttpTypes.AdminRegion }>(
        `/partners/stores/${storeId}/regions/${id}`,
        { method: "POST", body: payload }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: regionsQueryKeys.lists() })
      queryClient.invalidateQueries({ queryKey: regionsQueryKeys.details() })

      queryClient.invalidateQueries({
        queryKey: pricePreferencesQueryKeys.list(),
      })
      queryClient.invalidateQueries({
        queryKey: pricePreferencesQueryKeys.details(),
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useDeleteRegion = (
  id: string,
  options?: UseMutationOptions<
    HttpTypes.AdminRegionDeleteResponse,
    FetchError,
    void
  >
) => {
  const { stores } = usePartnerStores()
  const storeId = stores?.[0]?.id

  return useMutation({
    mutationFn: () =>
      sdk.client.fetch<HttpTypes.AdminRegionDeleteResponse>(
        `/partners/stores/${storeId}/regions/${id}`,
        { method: "DELETE" }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: regionsQueryKeys.lists() })
      queryClient.invalidateQueries({ queryKey: regionsQueryKeys.detail(id) })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}
