import { FetchError } from "@medusajs/js-sdk"
import {
  QueryKey,
  UseMutationOptions,
  UseQueryOptions,
  useMutation,
  useQuery,
} from "@tanstack/react-query"
import qs from "qs"

import { sdk } from "../../lib/client"
import { queryClient } from "../../lib/query-client"
import { queryKeysFactory } from "../../lib/query-key-factory"

const PARTNER_STORES_QUERY_KEY = "partner-stores" as const
export const partnerStoresQueryKeys = queryKeysFactory(PARTNER_STORES_QUERY_KEY)

export type PartnerStore = Record<string, any> & {
  id: string
  name?: string | null
}

export const useCreatePartnerStore = (
  options?: UseMutationOptions<PartnerStore, FetchError, PartnerStoreCreatePayload>
) => {
  return useMutation({
    mutationFn: async (payload) => {
      return await sdk.client.fetch<PartnerStore>(`/partners/stores`, {
        method: "POST",
        body: payload,
      })
    },
    onSuccess: async (data, variables, context) => {
      await queryClient.invalidateQueries({
        queryKey: partnerStoresQueryKeys.details(),
      })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export type PartnerStoresResponse = {
  partner_id: string
  count: number
  stores: PartnerStore[]
}

export type PartnerStoreCreatePayload = {
  store: {
    name: string
    supported_currencies: Array<{ currency_code: string; is_default: boolean }>
  }
  sales_channel?: {
    name: string
    description?: string
  }
  region?: {
    name: string
    currency_code: string
    countries: string[]
  }
  location?: {
    name: string
    address: {
      address_1: string
      city?: string
      postal_code?: string
      country_code: string
    }
  }
}

const fetchPartnerStores = async (): Promise<PartnerStoresResponse> => {
  const response = await sdk.client.fetch<PartnerStoresResponse>(
    "/partners/stores",
    {
      method: "GET",
    }
  )

  return response
}

export const usePartnerStores = (
  options?: Omit<
    UseQueryOptions<
      PartnerStoresResponse,
      FetchError,
      PartnerStoresResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: partnerStoresQueryKeys.details(),
    queryFn: fetchPartnerStores,
    ...options,
  })

  return {
    ...data,
    stores: data?.stores ?? [],
    ...rest,
  }
}

export const usePartnerStoresQueryString = (params?: Record<string, any>) => {
  const query = qs.stringify(params || {}, { skipNulls: true })
  return query ? `?${query}` : ""
}
