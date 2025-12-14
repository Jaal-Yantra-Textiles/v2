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

const PARTNER_INVENTORY_ORDERS_QUERY_KEY =
  "partner-inventory-orders" as const
export const partnerInventoryOrdersQueryKeys = queryKeysFactory(
  PARTNER_INVENTORY_ORDERS_QUERY_KEY
)

export type PartnerInventoryOrder = Record<string, any> & {
  id: string
  status?: string | null
  quantity?: number | null
  total_price?: number | null
  expected_delivery_date?: string | null
  order_date?: string | null
  is_sample?: boolean | null
  created_at?: string
  updated_at?: string
  partner_info?: Record<string, any>
  order_lines?: Array<Record<string, any>>
}

export type ListPartnerInventoryOrdersParams = {
  limit?: number
  offset?: number
  status?: string
}

export type PartnerInventoryOrdersListResponse = {
  inventory_orders: PartnerInventoryOrder[]
  count: number
  limit: number
  offset: number
}

export type PartnerInventoryOrderDetailResponse = {
  inventoryOrder: PartnerInventoryOrder
}

export type PartnerStartInventoryOrderResponse = {
  message?: string
  order?: any
  workflowResult?: any
}

export type PartnerCompleteInventoryOrderPayload = {
  notes?: string
  deliveryDate?: string
  delivery_date?: string
  trackingNumber?: string
  tracking_number?: string
  stock_location_id?: string
  stockLocationId?: string
  lines: { order_line_id: string; quantity: number }[]
}

export type PartnerCompleteInventoryOrderResponse = {
  message?: string
  result?: any
}

const buildQuery = (params?: Record<string, any>) => {
  const query = qs.stringify(params || {}, { skipNulls: true })
  return query ? `?${query}` : ""
}

export const usePartnerInventoryOrders = (
  params?: ListPartnerInventoryOrdersParams,
  options?: Omit<
    UseQueryOptions<
      PartnerInventoryOrdersListResponse,
      FetchError,
      PartnerInventoryOrdersListResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: partnerInventoryOrdersQueryKeys.list(params),
    queryFn: async () => {
      const q = buildQuery(params)
      return await sdk.client.fetch<PartnerInventoryOrdersListResponse>(
        `/partners/inventory-orders${q}`,
        { method: "GET" }
      )
    },
    ...options,
  })

  return {
    ...data,
    inventory_orders: data?.inventory_orders ?? [],
    ...rest,
  }
}

export const usePartnerInventoryOrder = (
  orderId: string,
  options?: Omit<
    UseQueryOptions<
      PartnerInventoryOrderDetailResponse,
      FetchError,
      PartnerInventoryOrderDetailResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: partnerInventoryOrdersQueryKeys.detail(orderId),
    queryFn: async () => {
      return await sdk.client.fetch<PartnerInventoryOrderDetailResponse>(
        `/partners/inventory-orders/${orderId}`,
        { method: "GET" }
      )
    },
    enabled: !!orderId,
    ...options,
  })

  return {
    ...data,
    inventoryOrder: data?.inventoryOrder,
    ...rest,
  }
}

export const useStartPartnerInventoryOrder = (
  orderId: string,
  options?: UseMutationOptions<
    PartnerStartInventoryOrderResponse,
    FetchError,
    void
  >
) => {
  return useMutation({
    mutationFn: async () =>
      sdk.client.fetch<PartnerStartInventoryOrderResponse>(
        `/partners/inventory-orders/${orderId}/start`,
        { method: "POST" }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: partnerInventoryOrdersQueryKeys.lists(),
      })
      queryClient.invalidateQueries({
        queryKey: partnerInventoryOrdersQueryKeys.detail(orderId),
      })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useCompletePartnerInventoryOrder = (
  orderId: string,
  options?: UseMutationOptions<
    PartnerCompleteInventoryOrderResponse,
    FetchError,
    PartnerCompleteInventoryOrderPayload
  >
) => {
  return useMutation({
    mutationFn: async (payload) =>
      sdk.client.fetch<PartnerCompleteInventoryOrderResponse>(
        `/partners/inventory-orders/${orderId}/complete`,
        { method: "POST", body: payload }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: partnerInventoryOrdersQueryKeys.lists(),
      })
      queryClient.invalidateQueries({
        queryKey: partnerInventoryOrdersQueryKeys.detail(orderId),
      })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}
