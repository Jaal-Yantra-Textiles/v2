import { FetchError } from "@medusajs/js-sdk";
import { HttpTypes } from "@medusajs/types";
import {
  QueryKey,
  useQuery,
  UseQueryOptions,
} from "@tanstack/react-query";
import { sdk } from "../../lib/config";
import { queryKeysFactory } from "../../lib/query-key-factory";

const PRODUCTS_QUERY_KEY = "products-from-admin" as const;
export const productsQueryKeys = {
  ...queryKeysFactory(PRODUCTS_QUERY_KEY),
  // Add any specific product query key patterns here if needed, e.g., detail(id: string)
};

export const useProducts = (
  query?: HttpTypes.AdminProductListParams,
  options?: Omit<
    UseQueryOptions<
      HttpTypes.AdminProductListResponse,
      FetchError,
      HttpTypes.AdminProductListResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () => sdk.admin.product.list(query),
    queryKey: productsQueryKeys.list(query),
    ...options,
  });

  // The 'data' object here will be of type HttpTypes.AdminProductListResponse | undefined
  // It contains: products, count, limit, offset
  return { ...data, ...rest };
};
