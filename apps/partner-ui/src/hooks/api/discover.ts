import { FetchError } from "@medusajs/js-sdk"
import {
  QueryKey,
  UseQueryOptions,
  useMutation,
  useQuery,
} from "@tanstack/react-query"
import { sdk } from "../../lib/client"
import { queryClient } from "../../lib/query-client"
import { queryKeysFactory } from "../../lib/query-key-factory"
import { productTypesQueryKeys } from "./product-types"

const DISCOVER_QUERY_KEY = "discover_products" as const
export const discoverQueryKeys = queryKeysFactory(DISCOVER_QUERY_KEY)

export interface DiscoverProduct {
  id: string
  title: string
  subtitle?: string | null
  description?: string | null
  handle: string
  thumbnail?: string | null
  status: string
  images?: Array<{ id: string; url: string }> | null
  variants?: Array<{
    id: string
    title: string
    sku?: string | null
    prices?: Array<{
      amount: number
      currency_code: string
    }>
  }> | null
  type?: { id: string; value: string } | null
  collection?: { id: string; title: string } | null
  tags?: Array<{ id: string; value: string }> | null
  categories?: Array<{ id: string; name: string }> | null
  sales_channels?: Array<{ id: string; name: string }> | null
}

export interface DiscoverProductsResponse {
  products: DiscoverProduct[]
  count: number
  offset: number
  limit: number
}

export const useDiscoverProducts = (
  query?: { limit?: number; offset?: number },
  options?: Omit<
    UseQueryOptions<
      DiscoverProductsResponse,
      FetchError,
      DiscoverProductsResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () =>
      sdk.client.fetch<DiscoverProductsResponse>(
        "/partners/discover/products",
        { method: "GET", query }
      ),
    queryKey: discoverQueryKeys.list(query),
    ...options,
  })

  return { ...data, ...rest }
}

export const useCopyProduct = () => {
  return useMutation({
    mutationFn: (productId: string) =>
      sdk.client.fetch<{ product: any; copied_from: string }>(
        `/partners/discover/products/${productId}/copy`,
        { method: "POST" }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: discoverQueryKeys.lists(),
      })
    },
  })
}
