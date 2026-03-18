import { QueryKey, useQuery, UseQueryOptions } from "@tanstack/react-query"
import { sdk } from "../../lib/client"
import { queryKeysFactory } from "../../lib/query-key-factory"
import { FetchError } from "@medusajs/js-sdk"
import { usePartnerStores } from "./partner-stores"

const PRODUCT_VARIANT_QUERY_KEY = "product_variant" as const
export const productVariantQueryKeys = queryKeysFactory(
  PRODUCT_VARIANT_QUERY_KEY
)

export const useVariants = (
  query?: Record<string, any>,
  options?: Omit<
    UseQueryOptions<any, FetchError, any, QueryKey>,
    "queryFn" | "queryKey"
  >
) => {
  const { stores } = usePartnerStores()
  const storeId = stores?.[0]?.id

  const { data, ...rest } = useQuery({
    queryFn: () =>
      sdk.client.fetch<any>(`/partners/stores/${storeId}/product-variants`, {
        method: "GET",
        query,
      }),
    queryKey: productVariantQueryKeys.list(query),
    enabled: !!storeId && (options?.enabled !== false),
    ...options,
  })

  return { ...data, ...rest }
}
