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
import { extractErrorMessage } from "../../lib/extract-error-message"

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
      onSuccess: (data, variables, onMutateResult, context) => {
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
        onSuccess?.(data, variables, onMutateResult, context)
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
    onSuccess: (data, variables, onMutateResult, context) => {
      queryClient.invalidateQueries({ queryKey: partnerProductionRunsQueryKeys.lists() })
      queryClient.invalidateQueries({ queryKey: partnerProductionRunsQueryKeys.detail(id) })
      queryClient.refetchQueries({ queryKey: partnerProductionRunsQueryKeys.lists() })
      queryClient.refetchQueries({ queryKey: partnerProductionRunsQueryKeys.detail(id) })
      queryClient.invalidateQueries({ queryKey: ["partner-assigned-tasks"] })
      queryClient.invalidateQueries({ queryKey: ["partner-designs"] })
      queryClient.invalidateQueries({ queryKey: ["partner-consumption-logs"] })
      onSuccess?.(data, variables, onMutateResult, context)
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
    onSuccess: (data, variables, onMutateResult, context) => {
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
      onSuccess?.(data, variables, onMutateResult, context)
    },
    ...restOptions,
  })
}

// #826 — advance MANY runs of a collated order in one action, so a partner
// isn't clicking through ten designs one-by-one. Accept / start need no data;
// finish carries the one shared note. Complete stays per-design (it needs each
// run's own output + cost form), walked one design at a time by the caller.
export type BatchAdvanceItem = {
  runId: string
  action: "accept" | "start" | "finish"
  notes?: string
}
/** `failed` keeps the server's reason, so the partner is told WHICH design and WHY. */
export type BatchAdvanceResult = {
  succeeded: string[]
  failed: { runId: string; message: string }[]
}

export const useBatchAdvancePartnerRuns = (
  options?: UseMutationOptions<
    BatchAdvanceResult,
    FetchError,
    { items: BatchAdvanceItem[] }
  >
) => {
  const { onSuccess, ...restOptions } = options || {}
  return useMutation({
    mutationFn: async ({ items }: { items: BatchAdvanceItem[] }) => {
      const results = await Promise.allSettled(
        items.map((it) =>
          sdk.client.fetch<any>(
            `/partners/production-runs/${it.runId}/${it.action}`,
            it.action === "finish"
              ? { method: "POST", body: it.notes ? { notes: it.notes } : {} }
              : { method: "POST" }
          )
        )
      )
      const succeeded: string[] = []
      const failed: { runId: string; message: string }[] = []
      results.forEach((r, i) => {
        if (r.status === "fulfilled") succeeded.push(items[i].runId)
        else failed.push({ runId: items[i].runId, message: extractErrorMessage(r.reason) })
      })
      return { succeeded, failed }
    },
    onSuccess: (data, variables, onMutateResult, context) => {
      queryClient.invalidateQueries({
        queryKey: partnerProductionRunsQueryKeys.lists(),
      })
      queryClient.refetchQueries({
        queryKey: partnerProductionRunsQueryKeys.lists(),
      })
      variables.items.forEach((it) => {
        queryClient.invalidateQueries({
          queryKey: partnerProductionRunsQueryKeys.detail(it.runId),
        })
        queryClient.refetchQueries({
          queryKey: partnerProductionRunsQueryKeys.detail(it.runId),
        })
      })
      queryClient.invalidateQueries({ queryKey: ["partner-designs"] })
      queryClient.invalidateQueries({ queryKey: ["partner-assigned-tasks"] })
      onSuccess?.(data, variables, onMutateResult, context)
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
    onSuccess: async (data, variables, onMutateResult, context) => {
      await queryClient.invalidateQueries({
        queryKey: partnerProductionRunsQueryKeys.lists(),
      })
      options?.onSuccess?.(data, variables, onMutateResult, context)
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

// #2401 — the profit share on a partner run made with our material (#2322).
// `percent: null` (and `summary.owed: null`) means there is no deal on this
// run: the screen hides everything rather than showing ₹0 owed.
export type PartnerProfitShareStatus =
  | "none"
  | "no_sales"
  | "open"
  | "settled"
  | "overpaid"

export type PartnerProfitShareSale = {
  id: string
  production_run_id: string
  partner_id: string | null
  quantity: number | string
  /** May arrive as a string / bigNumber — coerce with `Number`. */
  unit_price: number | string
  currency_code: string
  sold_at: string
  note: string | null
  reported_by: "admin" | "partner"
  actor_id: string | null
}

export type PartnerProfitShareSettlement = {
  id: string
  amount: number | string
  currency_code: string
  paid_at: string
  reference: string | null
  receipt_url: string | null
  note: string | null
}

export type PartnerProfitShareSummary = {
  percent: number | null
  currency_code: string
  run_quantity: number | null
  sold_quantity: number
  unsold_quantity: number | null
  gross_sales: number
  owed: number | null
  paid: number
  balance: number | null
  status: PartnerProfitShareStatus
  /** Mixed currencies across rows — the server refuses to sum them. */
  currency_mismatch: boolean
  working: string[]
}

export type PartnerProfitShare = {
  production_run_id: string
  partner_id: string | null
  percent: number | null
  sales: PartnerProfitShareSale[]
  settlements: PartnerProfitShareSettlement[]
  summary: PartnerProfitShareSummary
}

export type PartnerProfitShareResponse = { profit_share: PartnerProfitShare }

export type ReportPartnerSalePayload = {
  quantity: number
  unit_price: number
  currency_code?: string
  /** ISO datetime WITH an offset — the server rejects a bare date. */
  sold_at?: string
  note?: string
}

export type ReportPartnerSaleResponse = {
  sale: PartnerProfitShareSale
  profit_share: PartnerProfitShare
}

export const partnerRunProfitShareQueryKey = (runId: string) =>
  ["partner-run-profit-share", runId] as const

export const usePartnerRunProfitShare = (
  runId: string,
  options?: Omit<
    UseQueryOptions<
      PartnerProfitShareResponse,
      FetchError,
      PartnerProfitShareResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: partnerRunProfitShareQueryKey(runId),
    queryFn: async () =>
      sdk.client.fetch<PartnerProfitShareResponse>(
        `/partners/production-runs/${runId}/profit-share`,
        { method: "GET" }
      ),
    enabled: !!runId,
    ...options,
  })
  return { profit_share: data?.profit_share, ...rest }
}

export const useReportPartnerSale = (
  runId: string,
  options?: UseMutationOptions<
    ReportPartnerSaleResponse,
    FetchError,
    ReportPartnerSalePayload
  >
) => {
  const { onSuccess, ...restOptions } = options || {}
  return useMutation({
    mutationFn: async (payload: ReportPartnerSalePayload) =>
      sdk.client.fetch<ReportPartnerSaleResponse>(
        `/partners/production-runs/${runId}/profit-share/sales`,
        { method: "POST", body: payload }
      ),
    onSuccess: (data, variables, onMutateResult, context) => {
      // The POST returns the fresh profit share — show it at once, then let
      // the refetch confirm it.
      if (data?.profit_share) {
        queryClient.setQueryData<PartnerProfitShareResponse>(
          partnerRunProfitShareQueryKey(runId),
          { profit_share: data.profit_share }
        )
      }
      queryClient.invalidateQueries({
        queryKey: partnerRunProfitShareQueryKey(runId),
      })
      onSuccess?.(data, variables, onMutateResult, context)
    },
    ...restOptions,
  })
}
