import { FetchError } from "@medusajs/js-sdk"
import { HttpTypes } from "@medusajs/types"
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
import { usePartnerStores } from "./partner-stores"

const TAX_REGIONS_QUERY_KEY = "tax_regions" as const
export const taxRegionsQueryKeys = queryKeysFactory(TAX_REGIONS_QUERY_KEY)

export const useTaxRegion = (
  id: string,
  query?: HttpTypes.AdminTaxRegionParams,
  options?: Omit<
    UseQueryOptions<
      { tax_region: any },
      FetchError,
      { tax_region: any },
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { stores } = usePartnerStores()
  const storeId = stores?.[0]?.id

  const { data, ...rest } = useQuery({
    queryKey: taxRegionsQueryKeys.detail(id),
    queryFn: async () =>
      sdk.client.fetch<{ tax_region: any }>(
        `/partners/stores/${storeId}/tax-regions/${id}`,
        { method: "GET" }
      ),
    enabled: !!storeId && (options?.enabled !== false),
    ...options,
  })

  return { ...data, ...rest }
}

export const useTaxRegions = (
  query?: HttpTypes.AdminTaxRegionListParams,
  options?: Omit<
    UseQueryOptions<
      { tax_regions: any[]; count: number },
      FetchError,
      { tax_regions: any[]; count: number },
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { stores } = usePartnerStores()
  const storeId = stores?.[0]?.id

  const { data, ...rest } = useQuery({
    queryFn: () =>
      sdk.client.fetch<{ tax_regions: any[]; count: number }>(
        `/partners/stores/${storeId}/tax-regions`,
        { method: "GET" }
      ),
    queryKey: taxRegionsQueryKeys.list(query),
    enabled: !!storeId && (options?.enabled !== false),
    ...options,
  })

  return { ...data, ...rest }
}

export const useCreateTaxRegion = (
  options?: UseMutationOptions<
    { tax_region: any },
    FetchError,
    HttpTypes.AdminCreateTaxRegion
  >
) => {
  const { stores } = usePartnerStores()
  const storeId = stores?.[0]?.id

  return useMutation({
    mutationFn: (payload) =>
      sdk.client.fetch<{ tax_region: any }>(
        `/partners/stores/${storeId}/tax-regions`,
        { method: "POST", body: payload }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: taxRegionsQueryKeys.all })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useUpdateTaxRegion = (
  id: string,
  query?: HttpTypes.AdminTaxRegionParams,
  options?: UseMutationOptions<
    { tax_region: any },
    FetchError,
    HttpTypes.AdminUpdateTaxRegion,
    QueryKey
  >
) => {
  const { stores } = usePartnerStores()
  const storeId = stores?.[0]?.id

  return useMutation({
    mutationFn: (payload) =>
      sdk.client.fetch<{ tax_region: any }>(
        `/partners/stores/${storeId}/tax-regions/${id}`,
        { method: "POST", body: payload }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: taxRegionsQueryKeys.detail(id),
      })
      queryClient.invalidateQueries({ queryKey: taxRegionsQueryKeys.lists() })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useDeleteTaxRegion = (
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
        `/partners/stores/${storeId}/tax-regions/${id}`,
        { method: "DELETE" }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: taxRegionsQueryKeys.lists() })
      queryClient.invalidateQueries({
        queryKey: taxRegionsQueryKeys.detail(id),
      })

      queryClient.invalidateQueries({ queryKey: taxRegionsQueryKeys.details() })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}
