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

const PARTNER_PRODUCTION_RUNS_QUERY_KEY = "partner-production-runs" as const

export const partnerProductionRunsQueryKeys = queryKeysFactory(
  PARTNER_PRODUCTION_RUNS_QUERY_KEY
)

export type PartnerProductionRun = Record<string, any> & {
  id: string
  status?: string | null
  run_type?: "production" | "sample" | null
  role?: string | null
  quantity?: number | null
  design_id?: string | null
  partner_id?: string | null
  parent_run_id?: string | null
  accepted_at?: string | null
  started_at?: string | null
  finished_at?: string | null
  completed_at?: string | null
  created_at?: string
  updated_at?: string
  metadata?: Record<string, any> | null
  tasks?: Array<Record<string, any>>
}

export type ListPartnerProductionRunsParams = {
  limit?: number
  offset?: number
  status?: string
  role?: string
  run_type?: "production" | "sample"
  design_id?: string
}

export type PartnerProductionRunsListResponse = {
  production_runs: PartnerProductionRun[]
  count: number
  limit: number
  offset: number
}

export type PartnerProductionRunDetailResponse = {
  production_run: PartnerProductionRun
  tasks: Array<Record<string, any>>
}

export type PartnerAcceptProductionRunResponse = {
  result?: any
}

const buildQuery = (params?: Record<string, any>) => {
  const query = qs.stringify(params || {}, { skipNulls: true })
  return query ? `?${query}` : ""
}

export const usePartnerProductionRuns = (
  params?: ListPartnerProductionRunsParams,
  options?: Omit<
    UseQueryOptions<
      PartnerProductionRunsListResponse,
      FetchError,
      PartnerProductionRunsListResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: partnerProductionRunsQueryKeys.list(params),
    queryFn: async () => {
      const q = buildQuery(params)
      return await sdk.client.fetch<PartnerProductionRunsListResponse>(
        `/partners/production-runs${q}`,
        { method: "GET" }
      )
    },
    ...options,
  })

  return {
    ...data,
    production_runs: data?.production_runs ?? [],
    ...rest,
  }
}

export const usePartnerProductionRun = (
  id: string,
  options?: Omit<
    UseQueryOptions<
      PartnerProductionRunDetailResponse,
      FetchError,
      PartnerProductionRunDetailResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: partnerProductionRunsQueryKeys.detail(id),
    queryFn: async () =>
      await sdk.client.fetch<PartnerProductionRunDetailResponse>(
        `/partners/production-runs/${id}`,
        { method: "GET" }
      ),
    enabled: !!id,
    ...options,
  })

  return {
    ...data,
    production_run: data?.production_run,
    tasks: data?.tasks ?? data?.production_run?.tasks ?? [],
    ...rest,
  }
}

const createRunMilestoneHook = (action: string) => {
  return (
    id: string,
    options?: UseMutationOptions<any, FetchError, void>
  ) => {
    return useMutation({
      mutationFn: async () =>
        await sdk.client.fetch<any>(
          `/partners/production-runs/${id}/${action}`,
          { method: "POST" }
        ),
      onSuccess: (data, variables, context) => {
        // Invalidate and refetch all production run queries
        queryClient.invalidateQueries({
          queryKey: partnerProductionRunsQueryKeys.lists(),
        })
        queryClient.invalidateQueries({
          queryKey: partnerProductionRunsQueryKeys.detail(id),
        })
        queryClient.refetchQueries({
          queryKey: partnerProductionRunsQueryKeys.lists(),
        })
        queryClient.refetchQueries({
          queryKey: partnerProductionRunsQueryKeys.detail(id),
        })
        // Also refresh tasks and design data so the UI updates everywhere
        queryClient.invalidateQueries({ queryKey: ["partner-assigned-tasks"] })
        queryClient.invalidateQueries({ queryKey: ["partner-designs"] })
        options?.onSuccess?.(data, variables, context)
      },
      ...options,
    })
  }
}

export const useAcceptPartnerProductionRun = createRunMilestoneHook("accept")
export const useStartPartnerProductionRun = createRunMilestoneHook("start")

// Finish hook accepts optional body (notes)
export const useFinishPartnerProductionRun = (
  id: string,
  options?: UseMutationOptions<any, FetchError, any>
) => {
  return useMutation({
    mutationFn: async (body?: any) =>
      await sdk.client.fetch<any>(
        `/partners/production-runs/${id}/finish`,
        { method: "POST", body: body || {} }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: partnerProductionRunsQueryKeys.lists() })
      queryClient.invalidateQueries({ queryKey: partnerProductionRunsQueryKeys.detail(id) })
      queryClient.refetchQueries({ queryKey: partnerProductionRunsQueryKeys.lists() })
      queryClient.refetchQueries({ queryKey: partnerProductionRunsQueryKeys.detail(id) })
      queryClient.invalidateQueries({ queryKey: ["partner-assigned-tasks"] })
      queryClient.invalidateQueries({ queryKey: ["partner-designs"] })
      queryClient.invalidateQueries({ queryKey: ["partner-consumption-logs"] })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

// Complete hook accepts optional body (consumptions, cost estimate, notes)
export const useCompletePartnerProductionRun = (
  id: string,
  options?: UseMutationOptions<any, FetchError, any>
) => {
  return useMutation({
    mutationFn: async (body?: any) =>
      await sdk.client.fetch<any>(
        `/partners/production-runs/${id}/complete`,
        { method: "POST", body: body || {} }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: partnerProductionRunsQueryKeys.lists(),
      })
      queryClient.invalidateQueries({
        queryKey: partnerProductionRunsQueryKeys.detail(id),
      })
      queryClient.refetchQueries({
        queryKey: partnerProductionRunsQueryKeys.lists(),
      })
      queryClient.refetchQueries({
        queryKey: partnerProductionRunsQueryKeys.detail(id),
      })
      queryClient.invalidateQueries({ queryKey: ["partner-assigned-tasks"] })
      queryClient.invalidateQueries({ queryKey: ["partner-designs"] })
      queryClient.invalidateQueries({ queryKey: ["partner-consumption-logs"] })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}
