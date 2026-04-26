import { FetchError } from "@medusajs/js-sdk"
import { HttpTypes } from "@medusajs/types"
import {
  QueryKey,
  useQuery,
  UseQueryOptions,
} from "@tanstack/react-query"
import { sdk } from "../../lib/config"
import { queryKeysFactory } from "../../lib/query-key-factory"

const STORES_QUERY_KEY = "stores" as const
const storesQueryKeys = {
  ...queryKeysFactory(STORES_QUERY_KEY),
  default: () => [STORES_QUERY_KEY, "default"],
}

export const useStores = (
  query?: HttpTypes.AdminStoreListParams,
  options?: Omit<
    UseQueryOptions<
      HttpTypes.AdminStoreListResponse,
      FetchError,
      HttpTypes.AdminStoreListResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () => sdk.admin.store.list(query),
    queryKey: storesQueryKeys.list(query),
    ...options,
  })

  return { ...data, ...rest }
}

export const useDefaultStore = (
  options?: Omit<
    UseQueryOptions<
      HttpTypes.AdminStoreListResponse,
      FetchError,
      HttpTypes.AdminStoreListResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () => 
      sdk.admin.store.list({
        fields: "id,*supported_currencies, supported_currencies.currency.*"
      }),
    queryKey: storesQueryKeys.default(),
    ...options,
  })

  // Find the default store from the list (the one with is_default: true in supported_currencies)
  const defaultStoreData = data ? {
    ...data,
    store: data.stores?.find(store => 
      store.supported_currencies?.some(currency => currency.is_default)
    )
  } : undefined;

  return { ...defaultStoreData, ...rest }
}