import { FetchError } from "@medusajs/js-sdk"
import {
  QueryKey,
  UseMutationOptions,
  UseQueryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"

import { sdk } from "../../lib/config"
import { designQueryKeys } from "./designs"
import { queryKeysFactory } from "../../lib/query-key-factory"

const PRODUCTION_RUNS_QUERY_KEY = "production-runs" as const
export const productionRunQueryKeys = queryKeysFactory(PRODUCTION_RUNS_QUERY_KEY)

export type AdminCreateDesignProductionRunPayload = {
  quantity?: number
  assignments?: Array<{
    partner_id: string
    role?: string
    quantity: number
    order?: number
    template_names?: string[]
  }>
}

export type AdminProductionRun = Record<string, any> & {
  id: string
  status?: string
  run_type?: "production" | "sample"
  partner_id?: string | null
  design_id?: string
}

export type AdminCreateDesignProductionRunResponse =
  | {
      production_run: AdminProductionRun
    }
  | {
      production_run: AdminProductionRun
      children: AdminProductionRun[]
    }

export const useCreateDesignProductionRun = (
  designId: string,
  options?: UseMutationOptions<
    AdminCreateDesignProductionRunResponse,
    FetchError,
    AdminCreateDesignProductionRunPayload
  >
) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: AdminCreateDesignProductionRunPayload) =>
      sdk.client.fetch<AdminCreateDesignProductionRunResponse>(
        `/admin/designs/${designId}/production-runs`,
        {
          method: "POST",
          body: payload,
        }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: designQueryKeys.detail(designId) })
      queryClient.invalidateQueries({ queryKey: productionRunQueryKeys.lists() })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export type AdminProductionRunsResponse = {
  production_runs: AdminProductionRun[]
  count: number
  offset: number
  limit: number
}

export const useProductionRuns = (
  query?: Record<string, any>,
  options?: Omit<
    UseQueryOptions<
      AdminProductionRunsResponse,
      FetchError,
      AdminProductionRunsResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: productionRunQueryKeys.list(query),
    queryFn: async () =>
      sdk.client.fetch<AdminProductionRunsResponse>(`/admin/production-runs`, {
        method: "GET",
        query,
      }),
    ...options,
  })

  return { ...data, ...rest }
}

export type AdminProductionRunDetailResponse = {
  production_run: AdminProductionRun
  tasks: any[]
}

export const useProductionRun = (
  id: string,
  query?: Record<string, any>,
  options?: Omit<
    UseQueryOptions<
      AdminProductionRunDetailResponse,
      FetchError,
      AdminProductionRunDetailResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: productionRunQueryKeys.detail(id, query),
    queryFn: async () =>
      sdk.client.fetch<AdminProductionRunDetailResponse>(
        `/admin/production-runs/${id}`,
        {
          method: "GET",
          query,
        }
      ),
    ...options,
  })

  return { ...data, ...rest }
}

export type AdminSendProductionRunToProductionPayload = {
  run_id: string
  template_names: string[]
}

export type AdminSendProductionRunToProductionResponse = {
  result: any
}

export const useSendProductionRunToProduction = (
  options?: UseMutationOptions<
    AdminSendProductionRunToProductionResponse,
    FetchError,
    AdminSendProductionRunToProductionPayload
  >
) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: AdminSendProductionRunToProductionPayload) =>
      sdk.client.fetch<AdminSendProductionRunToProductionResponse>(
        `/admin/production-runs/${payload.run_id}/send-to-production`,
        {
          method: "POST",
          body: {
            template_names: payload.template_names,
          },
        }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: productionRunQueryKeys.lists() })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export type AdminApproveProductionRunPayload = {
  assignments?: Array<{
    partner_id: string
    role?: string
    quantity?: number
    order?: number
    template_names?: string[]
  }>
}

export type AdminApproveProductionRunResponse = {
  production_run: AdminProductionRun
  children?: AdminProductionRun[]
}

export const useCancelProductionRun = (
  runId: string,
  options?: UseMutationOptions<
    { production_run: AdminProductionRun; message: string },
    FetchError,
    { reason?: string }
  >
) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: { reason?: string }) =>
      sdk.client.fetch<{ production_run: AdminProductionRun; message: string }>(
        `/admin/production-runs/${runId}/cancel`,
        { method: "POST", body: payload }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: productionRunQueryKeys.detail(runId) })
      queryClient.invalidateQueries({ queryKey: productionRunQueryKeys.lists() })
      queryClient.invalidateQueries({ queryKey: designQueryKeys.lists() })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useApproveProductionRun = (
  runId: string,
  options?: UseMutationOptions<
    AdminApproveProductionRunResponse,
    FetchError,
    AdminApproveProductionRunPayload
  >
) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: AdminApproveProductionRunPayload) =>
      sdk.client.fetch<AdminApproveProductionRunResponse>(
        `/admin/production-runs/${runId}/approve`,
        {
          method: "POST",
          body: payload,
        }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: productionRunQueryKeys.detail(runId) })
      queryClient.invalidateQueries({ queryKey: productionRunQueryKeys.lists() })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}
