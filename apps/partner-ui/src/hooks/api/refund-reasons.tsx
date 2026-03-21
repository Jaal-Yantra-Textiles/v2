import {
  useMutation,
  UseMutationOptions,
  useQuery,
  UseQueryOptions,
  QueryKey,
} from "@tanstack/react-query"

import { FetchError } from "@medusajs/js-sdk"
import { sdk } from "../../lib/client"
import { queryClient } from "../../lib/query-client"
import { queryKeysFactory } from "../../lib/query-key-factory"

const REFUND_REASONS_QUERY_KEY = "refund_reasons" as const
export const refundReasonsQueryKeys = queryKeysFactory(REFUND_REASONS_QUERY_KEY)

type RefundReason = {
  id: string
  label: string
  description?: string
  created_at: string
  updated_at: string
}

type RefundReasonsResponse = {
  refund_reasons: RefundReason[]
  count: number
}

export const useRefundReasons = (
  query?: Record<string, any>,
  options?: Omit<
    UseQueryOptions<RefundReasonsResponse, FetchError, RefundReasonsResponse, QueryKey>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () =>
      sdk.client.fetch<RefundReasonsResponse>("/partners/refund-reasons", {
        method: "GET",
        query,
      }),
    queryKey: refundReasonsQueryKeys.list(query),
    ...options,
  })

  return { ...data, ...rest }
}

export const useRefundReason = (
  id: string,
  query?: Record<string, any>,
  options?: Omit<
    UseQueryOptions<{ refund_reason: RefundReason }, FetchError, { refund_reason: RefundReason }, QueryKey>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () =>
      sdk.client.fetch<{ refund_reason: RefundReason }>(`/partners/refund-reasons/${id}`, {
        method: "GET",
      }),
    queryKey: refundReasonsQueryKeys.detail(id),
    ...options,
  })

  return { ...data, ...rest }
}

export const useCreateRefundReason = (
  options?: UseMutationOptions<
    { refund_reason: RefundReason },
    FetchError,
    { label: string; description?: string }
  >
) => {
  return useMutation({
    mutationFn: async (data) =>
      sdk.client.fetch<{ refund_reason: RefundReason }>("/partners/refund-reasons", {
        method: "POST",
        body: data,
      }),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: refundReasonsQueryKeys.lists() })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useUpdateRefundReason = (
  id: string,
  options?: UseMutationOptions<
    { refund_reason: RefundReason },
    FetchError,
    { label?: string; description?: string }
  >
) => {
  return useMutation({
    mutationFn: async (data) =>
      sdk.client.fetch<{ refund_reason: RefundReason }>(`/partners/refund-reasons/${id}`, {
        method: "POST",
        body: data,
      }),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: refundReasonsQueryKeys.lists() })
      queryClient.invalidateQueries({ queryKey: refundReasonsQueryKeys.detail(id) })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useDeleteRefundReason = (
  options?: UseMutationOptions<any, FetchError, string>
) => {
  return useMutation({
    mutationFn: (id: string) =>
      sdk.client.fetch(`/partners/refund-reasons/${id}`, { method: "DELETE" }),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: refundReasonsQueryKeys.lists() })
      queryClient.invalidateQueries({ queryKey: refundReasonsQueryKeys.details() })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}
