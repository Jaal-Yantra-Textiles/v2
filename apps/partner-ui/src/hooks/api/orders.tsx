import { FetchError } from "@medusajs/js-sdk"
import { CreateOrderCreditLineDTO, HttpTypes } from "@medusajs/types"
import {
  QueryKey,
  useMutation,
  UseMutationOptions,
  useQuery,
  UseQueryOptions,
} from "@tanstack/react-query"
import { sdk } from "../../lib/client"
import { queryClient } from "../../lib/query-client"
import { queryKeysFactory, TQueryKey } from "../../lib/query-key-factory"
import { reservationItemsQueryKeys } from "./reservations"
import { inventoryItemsQueryKeys } from "./inventory"

const ORDERS_QUERY_KEY = "orders" as const
const _orderKeys = queryKeysFactory(ORDERS_QUERY_KEY) as TQueryKey<"orders"> & {
  preview: (orderId: string) => any
  changes: (orderId: string) => any
  lineItems: (orderId: string) => any
  shippingOptions: (orderId: string) => any
}

_orderKeys.preview = function (id: string) {
  return [this.detail(id), "preview"]
}

_orderKeys.changes = function (id: string) {
  return [this.detail(id), "changes"]
}

_orderKeys.lineItems = function (id: string) {
  return [this.detail(id), "lineItems"]
}

_orderKeys.shippingOptions = function (id: string) {
  return [this.detail(id), "shippingOptions"]
}

export const ordersQueryKeys = _orderKeys

export const useOrder = (
  id: string,
  query?: Record<string, any>,
  options?: Omit<
    UseQueryOptions<any, FetchError, any, QueryKey>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () =>
      sdk.client.fetch(`/partners/orders/${id}`, { method: "GET", query }),
    queryKey: ordersQueryKeys.detail(id, query),
    ...options,
  })

  return { ...data, ...rest }
}

export const useUpdateOrder = (
  id: string,
  options?: UseMutationOptions<
    HttpTypes.AdminOrderResponse,
    FetchError,
    HttpTypes.AdminUpdateOrder
  >
) => {
  return useMutation({
    mutationFn: (payload: HttpTypes.AdminUpdateOrder) =>
      sdk.client.fetch(`/partners/orders/${id}`, { method: "POST", body: payload }),
    onSuccess: (data: any, variables: any, context: any) => {
      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.detail(id),
      })

      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.changes(id),
      })

      // TODO: enable when needed
      // queryClient.invalidateQueries({
      //   queryKey: ordersQueryKeys.lists(),
      // })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useOrderPreview = (
  id: string,
  query?: HttpTypes.AdminOrderFilters,
  options?: Omit<
    UseQueryOptions<
      HttpTypes.AdminOrderPreviewResponse,
      FetchError,
      HttpTypes.AdminOrderPreviewResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () =>
      sdk.client.fetch(`/partners/orders/${id}/preview`, { method: "GET", query }),
    queryKey: ordersQueryKeys.preview(id),
    ...options,
  })

  return { ...data, ...rest }
}

export const useOrders = (
  query?: HttpTypes.AdminOrderFilters,
  options?: Omit<
    UseQueryOptions<
      HttpTypes.AdminOrderListResponse,
      FetchError,
      HttpTypes.AdminOrderListResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () =>
      sdk.client.fetch(`/partners/orders`, { method: "GET", query }),
    queryKey: ordersQueryKeys.list(query),
    ...options,
  })

  return { ...data, ...rest }
}

export const useOrderShippingOptions = (
  id: string,
  query?: HttpTypes.AdminGetOrderShippingOptionList,
  options?: Omit<
    UseQueryOptions<
      { shipping_options: HttpTypes.AdminShippingOption[] },
      FetchError,
      { shipping_options: HttpTypes.AdminShippingOption[] },
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () =>
      sdk.client.fetch(`/partners/orders/${id}/shipping-options`, { method: "GET", query }),
    queryKey: ordersQueryKeys.shippingOptions(id),
    ...options,
  })

  return { ...data, ...rest }
}

export const useOrderChanges = (
  id: string,
  query?: HttpTypes.AdminOrderChangesFilters,
  options?: Omit<
    UseQueryOptions<
      HttpTypes.AdminOrderChangesResponse,
      FetchError,
      HttpTypes.AdminOrderChangesResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () =>
      sdk.client.fetch(`/partners/orders/${id}/changes`, { method: "GET", query }),
    queryKey: ordersQueryKeys.changes(id),
    ...options,
  })

  return { ...data, ...rest }
}

export const useOrderLineItems = (
  id: string,
  query?: HttpTypes.AdminOrderItemsFilters,
  options?: Omit<
    UseQueryOptions<
      HttpTypes.AdminOrderLineItemsListResponse,
      FetchError,
      HttpTypes.AdminOrderLineItemsListResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () =>
      sdk.client.fetch(`/partners/orders/${id}/line-items`, { method: "GET", query }),
    queryKey: ordersQueryKeys.lineItems(id),
    ...options,
  })

  return { ...data, ...rest }
}

export const useCreateOrderFulfillment = (
  orderId: string,
  options?: UseMutationOptions<
    HttpTypes.AdminOrderResponse,
    FetchError,
    HttpTypes.AdminCreateOrderFulfillment
  >
) => {
  return useMutation({
    mutationFn: (payload: HttpTypes.AdminCreateOrderFulfillment) =>
      sdk.client.fetch(`/partners/orders/${orderId}/fulfillments`, { method: "POST", body: payload }),
    onSuccess: (data: any, variables: any, context: any) => {
      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.all,
      })

      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.preview(orderId),
      })

      queryClient.invalidateQueries({
        queryKey: reservationItemsQueryKeys.lists(),
      })

      queryClient.invalidateQueries({
        queryKey: inventoryItemsQueryKeys.details(),
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useCancelOrderFulfillment = (
  orderId: string,
  fulfillmentId: string,
  options?: UseMutationOptions<any, FetchError, any>
) => {
  return useMutation({
    mutationFn: (payload: { no_notification?: boolean }) =>
      sdk.client.fetch(`/partners/orders/${orderId}/fulfillments/${fulfillmentId}/cancel`, { method: "POST", body: payload }),
    onSuccess: (data: any, variables: any, context: any) => {
      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.all,
      })

      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.preview(orderId),
      })

      queryClient.invalidateQueries({
        queryKey: reservationItemsQueryKeys.lists(),
      })

      queryClient.invalidateQueries({
        queryKey: inventoryItemsQueryKeys.details(),
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useCreateOrderShipment = (
  orderId: string,
  fulfillmentId: string,
  options?: UseMutationOptions<
    { order: HttpTypes.AdminOrder },
    FetchError,
    HttpTypes.AdminCreateOrderShipment
  >
) => {
  return useMutation({
    mutationFn: (payload: HttpTypes.AdminCreateOrderShipment) =>
      sdk.client.fetch(`/partners/orders/${orderId}/fulfillments/${fulfillmentId}/shipment`, { method: "POST", body: payload }),
    onSuccess: (data: any, variables: any, context: any) => {
      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.all,
      })

      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.preview(orderId),
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useMarkOrderFulfillmentAsDelivered = (
  orderId: string,
  fulfillmentId: string,
  options?: UseMutationOptions<
    { order: HttpTypes.AdminOrder },
    FetchError,
    void
  >
) => {
  return useMutation({
    mutationFn: () =>
      sdk.client.fetch(`/partners/orders/${orderId}/fulfillments/${fulfillmentId}/mark-as-delivered`, { method: "POST" }),
    onSuccess: (data: any, variables: any, context: any) => {
      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.all,
      })

      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.preview(orderId),
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useCancelOrder = (
  orderId: string,
  options?: UseMutationOptions<HttpTypes.AdminOrderResponse, FetchError, void>
) => {
  return useMutation({
    mutationFn: () =>
      sdk.client.fetch(`/partners/orders/${orderId}/cancel`, { method: "POST" }),
    onSuccess: (data: any, variables: any, context: any) => {
      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.detail(orderId),
      })

      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.preview(orderId),
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useRequestTransferOrder = (
  orderId: string,
  options?: UseMutationOptions<
    HttpTypes.AdminOrderResponse,
    FetchError,
    HttpTypes.AdminRequestOrderTransfer
  >
) => {
  return useMutation({
    mutationFn: (payload: HttpTypes.AdminRequestOrderTransfer) =>
      sdk.client.fetch(`/partners/orders/${orderId}/transfer`, { method: "POST", body: payload }),
    onSuccess: (data: any, variables: any, context: any) => {
      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.preview(orderId),
      })

      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.changes(orderId),
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useCancelOrderTransfer = (
  orderId: string,
  options?: UseMutationOptions<any, FetchError, void>
) => {
  return useMutation({
    mutationFn: () =>
      sdk.client.fetch(`/partners/orders/${orderId}/transfer/cancel`, { method: "POST" }),
    onSuccess: (data: any, variables: any, context: any) => {
      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.preview(orderId),
      })

      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.changes(orderId),
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useCreateOrderCreditLine = (
  orderId: string,
  options?: UseMutationOptions<
    HttpTypes.AdminOrderResponse,
    FetchError,
    Omit<CreateOrderCreditLineDTO, "order_id">
  >
) => {
  return useMutation({
    mutationFn: (payload) =>
      sdk.client.fetch(`/partners/orders/${orderId}/credit-lines`, { method: "POST", body: payload }),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.details(),
      })

      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.preview(orderId),
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

// ── Fulfillment: Label, Tracking, Pickup ──

export const useFulfillmentLabel = (
  orderId: string,
  fulfillmentId: string,
  options?: Omit<
    UseQueryOptions<any, FetchError, any, QueryKey>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () =>
      sdk.client.fetch(
        `/partners/orders/${orderId}/fulfillments/${fulfillmentId}/label`,
        { method: "GET" }
      ),
    queryKey: [...ordersQueryKeys.detail(orderId), "fulfillment-label", fulfillmentId],
    enabled: false, // fetch on demand
    ...options,
  })

  return { ...data, ...rest }
}

export const useFulfillmentTracking = (
  orderId: string,
  fulfillmentId: string,
  options?: Omit<
    UseQueryOptions<any, FetchError, any, QueryKey>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () =>
      sdk.client.fetch(
        `/partners/orders/${orderId}/fulfillments/${fulfillmentId}/tracking`,
        { method: "GET" }
      ),
    queryKey: [...ordersQueryKeys.detail(orderId), "fulfillment-tracking", fulfillmentId],
    ...options,
  })

  return { ...data, ...rest }
}

export const useSchedulePickup = (
  orderId: string,
  fulfillmentId: string,
  options?: UseMutationOptions<
    any,
    FetchError,
    { pickup_date: string; pickup_time: string; expected_package_count?: number }
  >
) => {
  return useMutation({
    mutationFn: (payload: {
      pickup_date: string
      pickup_time: string
      expected_package_count?: number
    }) =>
      sdk.client.fetch(
        `/partners/orders/${orderId}/fulfillments/${fulfillmentId}/pickup`,
        { method: "POST", body: payload }
      ),
    onSuccess: (data: any, variables: any, context: any) => {
      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.detail(orderId),
      })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useUpdateOrderChange = (
  orderChangeId: string,
  options?: UseMutationOptions<
    HttpTypes.AdminOrderChangeResponse,
    FetchError,
    { carry_over_promotions: boolean }
  >
) => {
  return useMutation({
    mutationFn: (payload: { carry_over_promotions: boolean }) =>
      sdk.client.fetch(`/partners/orders/changes/${orderChangeId}`, { method: "POST", body: payload }),
    onSuccess: (data, variables, context) => {
      const orderId = data.order_change.order_id

      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.details(),
      })

      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.preview(orderId),
      })

      queryClient.invalidateQueries({
        queryKey: ordersQueryKeys.changes(orderId),
      })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}
