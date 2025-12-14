import { FetchError } from "@medusajs/js-sdk"
import { QueryKey, UseQueryOptions, useQuery } from "@tanstack/react-query"

import { sdk } from "../../lib/client"
import { queryKeysFactory } from "../../lib/query-key-factory"

const PARTNER_CURRENCIES_QUERY_KEY = "partner-currencies" as const
export const partnerCurrenciesQueryKeys = queryKeysFactory(
  PARTNER_CURRENCIES_QUERY_KEY
)

export type PartnerCurrency = {
  code: string
  name?: string | null
}

export type PartnerCurrenciesResponse = {
  currencies: PartnerCurrency[]
  count?: number
  limit?: number
  offset?: number
}

export type ListPartnerCurrenciesParams = {
  limit?: number
  offset?: number
}

export const usePartnerCurrencies = (
  params?: ListPartnerCurrenciesParams,
  options?: Omit<
    UseQueryOptions<
      PartnerCurrenciesResponse,
      FetchError,
      PartnerCurrenciesResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: partnerCurrenciesQueryKeys.list(params),
    queryFn: async () => {
      const qs = new URLSearchParams({
        limit: String(params?.limit ?? 100),
        offset: String(params?.offset ?? 0),
      })

      return await sdk.client.fetch<PartnerCurrenciesResponse>(
        `/partners/currencies?${qs.toString()}`,
        { method: "GET" }
      )
    },
    ...options,
  })

  return {
    ...data,
    currencies: data?.currencies ?? [],
    ...rest,
  }
}
