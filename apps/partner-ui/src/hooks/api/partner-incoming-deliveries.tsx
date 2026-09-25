import { FetchError } from "@medusajs/js-sdk"
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
import { inventoryItemsQueryKeys } from "./inventory"

/**
 * #2286 — inventory orders delivered TO this partner's warehouse, and the
 * receipt they confirm. The supplier's side of the same order lives under
 * `partner-inventory-orders`; this is the receiving side.
 */
export const partnerIncomingDeliveriesQueryKeys = queryKeysFactory(
  "partner-incoming-deliveries" as const
)

export type IncomingDeliveryLine = {
  id: string
  name: string | null
  unit: string | null
  ordered: number
  received: number
  outstanding: number
}

export type IncomingDelivery = {
  id: string
  status: string
  order_date: string | null
  expected_delivery_date: string | null
  is_sample: boolean
  from: string | null
  invoice_number: string | null
  lines: IncomingDeliveryLine[]
  outstanding: number
  fully_received: boolean
  can_confirm: boolean
  cannot_confirm_reason: "not_dispatched" | "fully_received" | null
  created_at: string
}

export type IncomingDeliveriesResponse = {
  incoming_deliveries: IncomingDelivery[]
  count: number
  location_id: string | null
}

export type ConfirmIncomingDeliveryPayload = {
  lines: { order_line_id: string; quantity: number }[]
  notes?: string
}

export const usePartnerIncomingDeliveries = (
  params?: { all?: boolean },
  options?: Omit<
    UseQueryOptions<IncomingDeliveriesResponse, FetchError, IncomingDeliveriesResponse, QueryKey>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: partnerIncomingDeliveriesQueryKeys.list(params),
    queryFn: async () =>
      sdk.client.fetch<IncomingDeliveriesResponse>(
        `/partners/incoming-deliveries${params?.all ? "?all=true" : ""}`,
        { method: "GET" }
      ),
    ...options,
  })
  return {
    ...rest,
    incoming_deliveries: data?.incoming_deliveries ?? [],
    count: data?.count ?? 0,
    location_id: data?.location_id ?? null,
  }
}

export const useConfirmIncomingDelivery = (
  orderId: string,
  options?: UseMutationOptions<any, FetchError, ConfirmIncomingDeliveryPayload>
) => {
  return useMutation({
    mutationFn: async (payload) =>
      sdk.client.fetch<any>(`/partners/incoming-deliveries/${orderId}/receive`, {
        method: "POST",
        body: payload,
      }),
    onSuccess: (data, variables, onMutateResult, context) => {
      queryClient.invalidateQueries({ queryKey: partnerIncomingDeliveriesQueryKeys.all })
      // The receipt is stock: the inventory screen must re-read.
      queryClient.invalidateQueries({ queryKey: inventoryItemsQueryKeys.all })
      options?.onSuccess?.(data, variables, onMutateResult, context)
    },
    ...options,
  })
}
