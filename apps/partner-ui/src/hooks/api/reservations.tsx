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
import {
  inventoryItemLevelsQueryKeys,
  inventoryItemsQueryKeys,
} from "./inventory.tsx"
import { FetchError } from "@medusajs/js-sdk"
import qs from "qs"

const RESERVATION_ITEMS_QUERY_KEY = "reservation_items" as const
export const reservationItemsQueryKeys = queryKeysFactory(
  RESERVATION_ITEMS_QUERY_KEY
)

const buildQuery = (params?: Record<string, any>) => {
  const query = qs.stringify(params || {}, { skipNulls: true, arrayFormat: "brackets" })
  return query ? `?${query}` : ""
}

export const useReservationItem = (
  id: string,
  query?: Record<string, any>,
  options?: Omit<
    UseQueryOptions<
      { reservation: any },
      FetchError,
      { reservation: any },
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: reservationItemsQueryKeys.detail(id),
    queryFn: async () =>
      sdk.client.fetch<{ reservation: any }>(
        `/partners/reservations/${id}`,
        { method: "GET" }
      ),
    enabled: !!id,
    ...options,
  })

  return { ...data, ...rest }
}

export const useReservationItems = (
  query?: Record<string, any>,
  options?: Omit<
    UseQueryOptions<
      { reservations: any[]; count: number; limit: number; offset: number },
      FetchError,
      { reservations: any[]; count: number; limit: number; offset: number },
      QueryKey
    >,
    "queryKey" | "queryFn"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () =>
      sdk.client.fetch<{ reservations: any[]; count: number; limit: number; offset: number }>(
        `/partners/reservations${buildQuery(query)}`,
        { method: "GET" }
      ),
    queryKey: reservationItemsQueryKeys.list(query),
    ...options,
  })

  return { ...data, ...rest }
}

export const useUpdateReservationItem = (
  id: string,
  options?: UseMutationOptions<
    { reservation: any },
    FetchError,
    { quantity?: number; location_id?: string; description?: string }
  >
) => {
  return useMutation({
    mutationFn: (payload) =>
      sdk.client.fetch<{ reservation: any }>(
        `/partners/reservations/${id}`,
        { method: "POST", body: payload }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: reservationItemsQueryKeys.detail(id),
      })
      queryClient.invalidateQueries({
        queryKey: reservationItemsQueryKeys.lists(),
      })
      queryClient.invalidateQueries({
        queryKey: inventoryItemsQueryKeys.details(),
      })
      queryClient.invalidateQueries({
        queryKey: inventoryItemLevelsQueryKeys.details(),
      })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useCreateReservationItem = (
  options?: UseMutationOptions<
    { reservation: any },
    FetchError,
    { inventory_item_id: string; location_id: string; quantity: number; description?: string }
  >
) => {
  return useMutation({
    mutationFn: (payload) =>
      sdk.client.fetch<{ reservation: any }>(
        `/partners/reservations`,
        { method: "POST", body: payload }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: reservationItemsQueryKeys.lists(),
      })
      queryClient.invalidateQueries({
        queryKey: inventoryItemsQueryKeys.details(),
      })
      queryClient.invalidateQueries({
        queryKey: inventoryItemLevelsQueryKeys.details(),
      })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useDeleteReservationItem = (
  id: string,
  options?: UseMutationOptions<
    { id: string; object: string; deleted: boolean },
    FetchError,
    void
  >
) => {
  return useMutation({
    mutationFn: () =>
      sdk.client.fetch<{ id: string; object: string; deleted: boolean }>(
        `/partners/reservations/${id}`,
        { method: "DELETE" }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: reservationItemsQueryKeys.lists(),
      })
      queryClient.invalidateQueries({
        queryKey: reservationItemsQueryKeys.detail(id),
      })
      queryClient.invalidateQueries({
        queryKey: inventoryItemsQueryKeys.details(),
      })
      queryClient.invalidateQueries({
        queryKey: inventoryItemLevelsQueryKeys.details(),
      })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}
