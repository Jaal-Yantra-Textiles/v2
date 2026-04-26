import { QueryKey, useQuery, UseQueryOptions } from "@tanstack/react-query";;
import { sdk } from "../../lib/config";
import { HttpTypes } from "@medusajs/types"
import { FetchError } from "@medusajs/js-sdk"
import { queryKeysFactory } from "../../lib/query-key-factory";
const STOCK_LOCATIONS_QUERY_KEY = "stock_locations_from_inventory_orders" as const
export const stockLocationsQueryKeys = queryKeysFactory(
  STOCK_LOCATIONS_QUERY_KEY
)
export const useStockLocations = (
    query?: HttpTypes.AdminStockLocationListParams,
    options?: Omit<
      UseQueryOptions<
        HttpTypes.AdminStockLocationListResponse,
        FetchError,
        HttpTypes.AdminStockLocationListResponse,
        QueryKey
      >,
      "queryKey" | "queryFn"
    >
  ) => {
    const { data, ...rest } = useQuery({
      queryFn: () => sdk.admin.stockLocation.list(query),
      queryKey: stockLocationsQueryKeys.list(query),
      ...options,
    })
  
    return { ...data, ...rest }
  }