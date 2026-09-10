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

const STOCK_LOCATIONS_PAGE_SIZE = 100

/**
 * Every stock location, paged to the endpoint's true `count`. The plain list
 * call defaults to `limit: 20`, so a picker fed by it silently loses every
 * location past that row — the same truncation class as #947/#1552. Used by
 * the searchable pickers, where "type the name and find it" has to hold for
 * the LAST location as much as the first.
 */
export const useAllStockLocations = (
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
    queryKey: [...stockLocationsQueryKeys.lists(), "fetch-all"],
    queryFn: async () => {
      const stock_locations: HttpTypes.AdminStockLocation[] = []
      let offset = 0
      // Bound the round-trips, not the result — a page cap here would be the
      // silent truncation this hook exists to prevent.
      const maxPages = 50
      for (let page = 0; page < maxPages; page++) {
        const res = await sdk.admin.stockLocation.list({
          limit: STOCK_LOCATIONS_PAGE_SIZE,
          offset,
        })
        stock_locations.push(...(res.stock_locations ?? []))
        const total = res.count ?? stock_locations.length
        offset += res.stock_locations?.length ?? 0
        if (!res.stock_locations?.length || offset >= total) {
          break
        }
      }
      return { stock_locations, count: stock_locations.length }
    },
    ...options,
  })

  return { ...data, ...rest }
}