import {
  QueryKey,
  UseMutationOptions,
  UseQueryOptions,
  useMutation,
  useQuery,
} from "@tanstack/react-query"

import { FetchError } from "@medusajs/js-sdk"
import { sdk } from "../../lib/client"
import { queryClient } from "../../lib/query-client"
import { queryKeysFactory } from "../../lib/query-key-factory"

const RETURN_REASONS_QUERY_KEY = "return_reasons" as const
export const returnReasonsQueryKeys = queryKeysFactory(RETURN_REASONS_QUERY_KEY)

type ReturnReason = {
  id: string
  value: string
  label: string
  description?: string
  parent_return_reason_id?: string
  created_at: string
  updated_at: string
}

type ReturnReasonsResponse = {
  return_reasons: ReturnReason[]
  count: number
}

export const useReturnReasons = (
  query?: Record<string, any>,
  options?: Omit<
    UseQueryOptions<ReturnReasonsResponse, FetchError, ReturnReasonsResponse, QueryKey>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () =>
      sdk.client.fetch<ReturnReasonsResponse>("/partners/return-reasons", {
        method: "GET",
        query,
      }),
    queryKey: returnReasonsQueryKeys.list(query),
    ...options,
  })

  return { ...data, ...rest }
}

export const useReturnReason = (
  id: string,
  query?: Record<string, any>,
  options?: Omit<
    UseQueryOptions<{ return_reason: ReturnReason }, FetchError, { return_reason: ReturnReason }, QueryKey>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () =>
      sdk.client.fetch<{ return_reason: ReturnReason }>(`/partners/return-reasons/${id}`, {
        method: "GET",
      }),
    queryKey: returnReasonsQueryKeys.detail(id),
    ...options,
  })

  return { ...data, ...rest }
}

export const useCreateReturnReason = (
  query?: any,
  options?: UseMutationOptions<
    { return_reason: ReturnReason },
    FetchError,
    { value: string; label: string; description?: string }
  >
) => {
  return useMutation({
    mutationFn: async (data) =>
      sdk.client.fetch<{ return_reason: ReturnReason }>("/partners/return-reasons", {
        method: "POST",
        body: data,
      }),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: returnReasonsQueryKeys.lists() })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useUpdateReturnReason = (
  id: string,
  query?: any,
  options?: UseMutationOptions<
    { return_reason: ReturnReason },
    FetchError,
    { value?: string; label?: string; description?: string }
  >
) => {
  return useMutation({
    mutationFn: async (data) =>
      sdk.client.fetch<{ return_reason: ReturnReason }>(`/partners/return-reasons/${id}`, {
        method: "POST",
        body: data,
      }),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: returnReasonsQueryKeys.lists() })
      queryClient.invalidateQueries({ queryKey: returnReasonsQueryKeys.detail(id) })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useDeleteReturnReason = (
  id: string,
  options?: UseMutationOptions<any, FetchError, void>
) => {
  return useMutation({
    mutationFn: () =>
      sdk.client.fetch(`/partners/return-reasons/${id}`, { method: "DELETE" }),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: returnReasonsQueryKeys.lists() })
      queryClient.invalidateQueries({ queryKey: returnReasonsQueryKeys.details() })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}
