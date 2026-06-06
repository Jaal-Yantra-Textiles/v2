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
    const { onSuccess, ...restOptions } = options || {}
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
        onSuccess?.(data, variables, context)
      },
      ...restOptions,
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
  const { onSuccess, ...restOptions } = options || {}
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
      onSuccess?.(data, variables, context)
    },
    ...restOptions,
  })
}

// Complete hook accepts optional body (consumptions, cost estimate, notes)
export const useCompletePartnerProductionRun = (
  id: string,
  options?: UseMutationOptions<any, FetchError, any>
) => {
  const { onSuccess, ...restOptions } = options || {}
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
      onSuccess?.(data, variables, context)
    },
    ...restOptions,
  })
}

// Roadmap #6 Phase 4 — partner creates a self-approved run on their own design.
export type CreatePartnerProductionRunPayload = {
  quantity?: number
  run_type?: "production" | "sample"
  execution_mode: "in_house" | "outsourced"
  sub_partner_id?: string
}

export const useCreatePartnerProductionRun = (
  designId: string,
  options?: UseMutationOptions<
    { production_run: PartnerProductionRun },
    FetchError,
    CreatePartnerProductionRunPayload
  >
) => {
  return useMutation({
    mutationFn: async (payload) =>
      sdk.client.fetch<{ production_run: PartnerProductionRun }>(
        `/partners/designs/${designId}/production-runs`,
        { method: "POST", body: payload }
      ),
    onSuccess: async (data, variables, context) => {
      await queryClient.invalidateQueries({
        queryKey: partnerProductionRunsQueryKeys.lists(),
      })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

// Roadmap #6 Phase 5 — partner reads a run's cost-summary (admin parity).
export type PartnerRunCostSummary = {
  cost_summary: {
    production_run_id: string
    design_id: string
    status: string
    quantity: number
    produced_quantity: number | null
    material: { total: number; items: any[] }
    energy: { total: number; breakdown: any[] }
    labor: { total: number; total_hours: number; rate_per_hour: number | null }
    partner: { estimate: number | null; cost_type: string; total: number | null }
    grand_total: number | null
    cost_per_unit: number | null
    total_consumption_logs: number
  }
}

export const usePartnerRunCostSummary = (
  runId: string,
  options?: Omit<
    UseQueryOptions<
      PartnerRunCostSummary,
      FetchError,
      PartnerRunCostSummary,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: ["partner-run-cost-summary", runId],
    queryFn: async () =>
      sdk.client.fetch<PartnerRunCostSummary>(
        `/partners/production-runs/${runId}/cost-summary`,
        { method: "GET" }
      ),
    ...options,
  })
  return { cost_summary: data?.cost_summary, ...rest }
}
