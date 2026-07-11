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

export type PartnerSubmitPaymentPayload = {
  amount: number
  payment_type?: "Bank" | "Cash" | "Digital_Wallet"
  payment_date?: string
  note?: string
  paid_to_id?: string
}

export type PartnerSubmitPaymentResponse = {
  message?: string
  payment?: any
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

// #790 — mark an inventory order "Ready for Delivery" (Processing/Partial → it).
export const useMarkPartnerInventoryOrderReadyForDelivery = (
  orderId: string,
  options?: UseMutationOptions<{ order: any }, FetchError, void>
) => {
  return useMutation({
    mutationFn: async () =>
      sdk.client.fetch<{ order: any }>(
        `/partners/inventory-orders/${orderId}/ready-for-delivery`,
        { method: "POST", body: {} }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: partnerInventoryOrdersQueryKeys.lists() })
      queryClient.invalidateQueries({ queryKey: partnerInventoryOrdersQueryKeys.detail(orderId) })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

// #790 — generate a standalone carrier shipment (AWB + label) for the order.
export type PartnerCreateShipmentPayload = {
  carrier?: string
  pickup_stock_location_id?: string
  weight_grams?: number
  dimensions_cm?: { length?: number; breadth?: number; height?: number }
  preferred_courier_id?: string | number
  delivered_quantities?: Record<string, number>
  /** Requested carrier pickup date ("YYYY-MM-DD"). */
  pickup_date?: string
}

export const useCreatePartnerInventoryOrderShipment = (
  orderId: string,
  options?: UseMutationOptions<{ shipment?: any }, FetchError, PartnerCreateShipmentPayload>
) => {
  return useMutation({
    mutationFn: async (payload) =>
      sdk.client.fetch<{ shipment?: any }>(
        `/partners/inventory-orders/${orderId}/shipment`,
        { method: "POST", body: payload }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: partnerInventoryOrdersQueryKeys.lists() })
      queryClient.invalidateQueries({ queryKey: partnerInventoryOrdersQueryKeys.detail(orderId) })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

// #641-inv — on-demand Shiprocket courier rates for the order.
export type PartnerShiprocketRateOption = {
  courier_id: number | string
  courier_name: string
  amount: number
  currency_code: string
  estimated_days?: number
  cod_charges?: number
  is_recommended?: boolean
}

export type PartnerShiprocketRatesResponse = {
  origin_pincode: string
  destination_pincode: string
  weight_grams: number
  cod: boolean
  rates: PartnerShiprocketRateOption[]
}

export type PartnerShiprocketRatesParams = {
  carrier?: string
  weight_grams?: number
  length?: number
  breadth?: number
  height?: number
}

const partnerRatesQuery = (params: PartnerShiprocketRatesParams): string => {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v != null && Number.isFinite(Number(v)) && Number(v) > 0) qs.set(k, String(v))
  }
  const s = qs.toString()
  return s ? `?${s}` : ""
}

export const usePartnerInventoryOrderShiprocketRates = (
  orderId: string,
  options?: UseMutationOptions<
    PartnerShiprocketRatesResponse,
    FetchError,
    PartnerShiprocketRatesParams
  >
) => {
  return useMutation({
    mutationFn: async (params: PartnerShiprocketRatesParams) =>
      sdk.client.fetch<PartnerShiprocketRatesResponse>(
        `/partners/inventory-orders/${orderId}/shiprocket-rates${partnerRatesQuery(params)}`,
        { method: "GET" }
      ),
    ...options,
  })
}

export const useSubmitPartnerInventoryOrderPayment = (
  orderId: string,
  options?: UseMutationOptions<
    PartnerSubmitPaymentResponse,
    FetchError,
    PartnerSubmitPaymentPayload
  >
) => {
  return useMutation({
    mutationFn: async (payload) =>
      sdk.client.fetch<PartnerSubmitPaymentResponse>(
        `/partners/inventory-orders/${orderId}/submit-payment`,
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
