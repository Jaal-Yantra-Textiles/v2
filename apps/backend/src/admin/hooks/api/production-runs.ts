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
  run_type?: string
  assignments?: Array<{
    partner_id: string
    role?: string
    quantity: number
    order?: number
    /** #1268 — preferred; a name may match two templates and become undispatchable. */
    template_ids?: string[]
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
    onSuccess: (data, variables, _mutateResult, context) => {
      queryClient.invalidateQueries({ queryKey: designQueryKeys.detail(designId) })
      queryClient.invalidateQueries({ queryKey: productionRunQueryKeys.lists() })
      options?.onSuccess?.(data, variables, _mutateResult, context)
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
  /** Preferred — see `AdminResumeDispatchPayload`. */
  template_ids?: string[]
  template_names?: string[]
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
            template_ids: payload.template_ids,
            template_names: payload.template_names,
          },
        }
      ),
    onSuccess: (data, variables, _mutateResult, context) => {
      queryClient.invalidateQueries({ queryKey: productionRunQueryKeys.lists() })
      options?.onSuccess?.(data, variables, _mutateResult, context)
    },
    ...options,
  })
}

// --- Dispatch hooks ---

export type AdminStartDispatchResponse = {
  transaction_id: string
}

export const useStartDispatch = (
  runId: string,
  options?: UseMutationOptions<AdminStartDispatchResponse, FetchError, void>
) => {
  return useMutation({
    mutationFn: async () =>
      sdk.client.fetch<AdminStartDispatchResponse>(
        `/admin/production-runs/${runId}/start-dispatch`,
        { method: "POST" }
      ),
    ...options,
  })
}

export type AdminResumeDispatchPayload = {
  transaction_id: string
  /**
   * #1261 — a name is not an identity: prod carries two "Stitching" templates
   * differing only by category, and dispatch REFUSES an ambiguous name rather
   * than picking one. Send ids; names remain accepted for older callers.
   */
  template_ids?: string[]
  template_names?: string[]
}

export type AdminResumeDispatchResponse = {
  success: boolean
}

export const useResumeDispatch = (
  runId: string,
  options?: UseMutationOptions<
    AdminResumeDispatchResponse,
    FetchError,
    AdminResumeDispatchPayload
  >
) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: AdminResumeDispatchPayload) =>
      sdk.client.fetch<AdminResumeDispatchResponse>(
        `/admin/production-runs/${runId}/resume-dispatch`,
        { method: "POST", body: payload }
      ),
    onSuccess: (data, variables, _mutateResult, context) => {
      queryClient.invalidateQueries({ queryKey: productionRunQueryKeys.detail(runId) })
      queryClient.invalidateQueries({ queryKey: productionRunQueryKeys.lists() })
      queryClient.invalidateQueries({ queryKey: designQueryKeys.lists() })
      options?.onSuccess?.(data, variables, _mutateResult, context)
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
    /** #1268 — preferred; a name may match two templates and become undispatchable. */
    template_ids?: string[]
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
    onSuccess: (data, variables, _mutateResult, context) => {
      queryClient.invalidateQueries({ queryKey: productionRunQueryKeys.detail(runId) })
      queryClient.invalidateQueries({ queryKey: productionRunQueryKeys.lists() })
      queryClient.invalidateQueries({ queryKey: designQueryKeys.lists() })
      options?.onSuccess?.(data, variables, _mutateResult, context)
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
    onSuccess: (data, variables, _mutateResult, context) => {
      queryClient.invalidateQueries({ queryKey: productionRunQueryKeys.detail(runId) })
      queryClient.invalidateQueries({ queryKey: productionRunQueryKeys.lists() })
      options?.onSuccess?.(data, variables, _mutateResult, context)
    },
    ...options,
  })
}

export type AdminAssignProductionRunPartnerPayload = {
  partner_id: string
  note?: string | null
}

export type AdminAssignProductionRunPartnerResponse = {
  production_run: AdminProductionRun
  previous_partner_id: string | null
  same_partner: boolean
}

/**
 * #1228 — point a run at a partner by hand. The recovery path out of
 * `awaiting_reassignment`, and the "send it to the same partner again" action.
 * The run lands on `approved`; the operator's next step is Dispatch.
 */
export const useAssignProductionRunPartner = (
  runId: string,
  options?: UseMutationOptions<
    AdminAssignProductionRunPartnerResponse,
    FetchError,
    AdminAssignProductionRunPartnerPayload
  >
) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: AdminAssignProductionRunPartnerPayload) =>
      sdk.client.fetch<AdminAssignProductionRunPartnerResponse>(
        `/admin/production-runs/${runId}/assign-partner`,
        { method: "POST", body: payload }
      ),
    onSuccess: (data, variables, _mutateResult, context) => {
      queryClient.invalidateQueries({ queryKey: productionRunQueryKeys.detail(runId) })
      queryClient.invalidateQueries({ queryKey: productionRunQueryKeys.lists() })
      queryClient.invalidateQueries({ queryKey: designQueryKeys.lists() })
      options?.onSuccess?.(data, variables, _mutateResult, context)
    },
    ...options,
  })
}

export type AdminUpdateProductionRunPayload = {
  quantity?: number
  role?: string
  run_type?: string
  partner_cost_estimate?: number | null
  cost_type?: "total" | "per_unit"
}

export const useUpdateProductionRun = (
  runId: string,
  options?: UseMutationOptions<
    { production_run: AdminProductionRun },
    FetchError,
    AdminUpdateProductionRunPayload
  >
) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload) =>
      sdk.client.fetch<{ production_run: AdminProductionRun }>(
        `/admin/production-runs/${runId}`,
        { method: "POST", body: payload }
      ),
    onSuccess: (data, variables, _mutateResult, context) => {
      queryClient.invalidateQueries({ queryKey: productionRunQueryKeys.detail(runId) })
      queryClient.invalidateQueries({ queryKey: productionRunQueryKeys.lists() })
      queryClient.invalidateQueries({ queryKey: designQueryKeys.lists() })
      options?.onSuccess?.(data, variables, _mutateResult, context)
    },
    ...options,
  })
}

// --- Production-run task hooks ---

export type AdminProductionRunTask = Record<string, any> & {
  id: string
  title?: string
  description?: string
  status?: string
  priority?: string
  start_date?: string | null
  end_date?: string | null
  parent_task_id?: string | null
  subtasks?: AdminProductionRunTask[]
}

export type AdminProductionRunTaskResponse = {
  task: AdminProductionRunTask
}

export const useProductionRunTask = (
  runId: string,
  taskId: string,
  options?: Omit<
    UseQueryOptions<
      AdminProductionRunTaskResponse,
      FetchError,
      AdminProductionRunTaskResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: [...productionRunQueryKeys.detail(runId), "tasks", taskId],
    queryFn: async () =>
      sdk.client.fetch<AdminProductionRunTaskResponse>(
        `/admin/production-runs/${runId}/tasks/${taskId}`,
        { method: "GET" }
      ),
    ...options,
  })

  return { ...data, ...rest }
}

/**
 * A row of the run's activity stream — lifecycle transitions, reminder
 * dispatches, admin corrections, and goods movement. Written by
 * `production-run-activity-recorder` and by the routes that act on a run.
 */
export type AdminProductionRunActivity = Record<string, any> & {
  id: string
  production_run_id: string
  activity_type: "lifecycle_event" | "reminder_sent" | "note" | "system"
  kind: string
  actor_type?: string | null
  actor_id?: string | null
  partner_id?: string | null
  channel?: string | null
  template_name?: string | null
  summary: string
  payload?: Record<string, any> | null
  occurred_at: string
}

export type AdminProductionRunActivitiesResponse = {
  activities: AdminProductionRunActivity[]
  count: number
  limit: number
  offset: number
}

export const useProductionRunActivities = (
  runId: string,
  query?: Record<string, any>,
  options?: Omit<
    UseQueryOptions<
      AdminProductionRunActivitiesResponse,
      FetchError,
      AdminProductionRunActivitiesResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: [...productionRunQueryKeys.detail(runId), "activities", query],
    queryFn: async () =>
      sdk.client.fetch<AdminProductionRunActivitiesResponse>(
        `/admin/production-runs/${runId}/activities`,
        { method: "GET", query }
      ),
    ...options,
  })

  return { ...data, ...rest }
}

export type AdminUpdateProductionRunTaskPayload = {
  title?: string
  description?: string
  status?: string
  priority?: string
  start_date?: Date | string | null
  end_date?: Date | string | null
  metadata?: Record<string, any>
}

export const useUpdateProductionRunTask = (
  runId: string,
  taskId: string,
  options?: UseMutationOptions<
    AdminProductionRunTaskResponse,
    FetchError,
    AdminUpdateProductionRunTaskPayload
  >
) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload) =>
      sdk.client.fetch<AdminProductionRunTaskResponse>(
        `/admin/production-runs/${runId}/tasks/${taskId}`,
        { method: "POST", body: payload }
      ),
    onSuccess: (data, variables, _mutateResult, context) => {
      queryClient.invalidateQueries({
        queryKey: [...productionRunQueryKeys.detail(runId), "tasks", taskId],
      })
      queryClient.invalidateQueries({
        queryKey: productionRunQueryKeys.detail(runId),
      })
      queryClient.invalidateQueries({
        queryKey: productionRunQueryKeys.lists(),
      })
      options?.onSuccess?.(data, variables, _mutateResult, context)
    },
    ...options,
  })
}

export type AdminRecreateProductionRunPayload = {
  designs: Array<{
    design_id: string
    quantity: number
    notes?: string
  }>
  partner_id: string
  run_type?: "production" | "sample"
  notes?: string
  metadata?: Record<string, any>
}

export type AdminRecreateProductionRunResponse = {
  production_run: AdminProductionRun
  children: AdminProductionRun[]
}

export const useRecreateProductionRun = (
  options?: UseMutationOptions<
    AdminRecreateProductionRunResponse,
    FetchError,
    AdminRecreateProductionRunPayload
  >
) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: AdminRecreateProductionRunPayload) =>
      sdk.client.fetch<AdminRecreateProductionRunResponse>(
        `/admin/designs/recreate-production-run`,
        {
          method: "POST",
          body: payload,
        }
      ),
    onSuccess: (data, variables, _mutateResult, context) => {
      queryClient.invalidateQueries({ queryKey: designQueryKeys.lists() })
      queryClient.invalidateQueries({ queryKey: productionRunQueryKeys.lists() })
      options?.onSuccess?.(data, variables, _mutateResult, context)
    },
    ...options,
  })
}

// --- WhatsApp messaging inbox integration hooks ---
// These hooks power the per-message actions in the WhatsApp conversation
// view: log a message as a run activity note, attach media to a run, and
// complete a run from a partner's WhatsApp message.

export type AdminAddRunActivityNotePayload = {
  summary: string
  message_id?: string
  conversation_id?: string
  partner_id?: string
  payload?: Record<string, any>
}

export const useAddRunActivityNote = (
  runId: string,
  options?: UseMutationOptions<
    { activity: AdminProductionRunActivity },
    FetchError,
    AdminAddRunActivityNotePayload
  >
) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: AdminAddRunActivityNotePayload) =>
      sdk.client.fetch<{ activity: AdminProductionRunActivity }>(
        `/admin/production-runs/${runId}/activities/note`,
        { method: "POST", body: payload }
      ),
    onSuccess: (data, variables, _mutateResult, context) => {
      queryClient.invalidateQueries({
        queryKey: [...productionRunQueryKeys.detail(runId), "activities"],
      })
      options?.onSuccess?.(data, variables, _mutateResult, context)
    },
    ...options,
  })
}

export type AdminCompleteRunPayload = {
  produced_quantity?: number
  rejected_quantity?: number
  rejection_reason?: string
  rejection_notes?: string
  partner_cost_estimate?: number
  cost_type?: "per_unit" | "total"
  notes?: string
  allow_shortfall?: boolean
  from_message_id?: string
  from_conversation_id?: string
}

export const useAdminCompleteRun = (
  runId: string,
  options?: UseMutationOptions<
    { production_run: AdminProductionRun; message: string },
    FetchError,
    AdminCompleteRunPayload
  >
) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: AdminCompleteRunPayload) =>
      sdk.client.fetch<{ production_run: AdminProductionRun; message: string }>(
        `/admin/production-runs/${runId}/complete`,
        { method: "POST", body: payload }
      ),
    onSuccess: (data, variables, _mutateResult, context) => {
      queryClient.invalidateQueries({ queryKey: productionRunQueryKeys.detail(runId) })
      queryClient.invalidateQueries({ queryKey: productionRunQueryKeys.lists() })
      queryClient.invalidateQueries({ queryKey: designQueryKeys.lists() })
      options?.onSuccess?.(data, variables, _mutateResult, context)
    },
    ...options,
  })
}

// --- Admin lifecycle hooks (accept / start / finish) ---
// These mirror the partner-side accept/start/finish but are initiated by an
// admin on behalf of the assigned partner.

export const useAdminAcceptRun = (
  runId: string,
  options?: UseMutationOptions<
    { production_run: AdminProductionRun; message: string },
    FetchError,
    void
  >
) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () =>
      sdk.client.fetch<{ production_run: AdminProductionRun; message: string }>(
        `/admin/production-runs/${runId}/accept`,
        { method: "POST" }
      ),
    onSuccess: (data, variables, _mutateResult, context) => {
      queryClient.invalidateQueries({ queryKey: productionRunQueryKeys.detail(runId) })
      queryClient.invalidateQueries({ queryKey: productionRunQueryKeys.lists() })
      options?.onSuccess?.(data, variables, _mutateResult, context)
    },
    ...options,
  })
}

export const useAdminStartRun = (
  runId: string,
  options?: UseMutationOptions<
    { production_run: AdminProductionRun; message: string },
    FetchError,
    void
  >
) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () =>
      sdk.client.fetch<{ production_run: AdminProductionRun; message: string }>(
        `/admin/production-runs/${runId}/start`,
        { method: "POST" }
      ),
    onSuccess: (data, variables, _mutateResult, context) => {
      queryClient.invalidateQueries({ queryKey: productionRunQueryKeys.detail(runId) })
      queryClient.invalidateQueries({ queryKey: productionRunQueryKeys.lists() })
      options?.onSuccess?.(data, variables, _mutateResult, context)
    },
    ...options,
  })
}

export type AdminFinishRunPayload = {
  notes?: string
}

export const useAdminFinishRun = (
  runId: string,
  options?: UseMutationOptions<
    { production_run: AdminProductionRun; message: string },
    FetchError,
    AdminFinishRunPayload
  >
) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: AdminFinishRunPayload) =>
      sdk.client.fetch<{ production_run: AdminProductionRun; message: string }>(
        `/admin/production-runs/${runId}/finish`,
        { method: "POST", body: payload }
      ),
    onSuccess: (data, variables, _mutateResult, context) => {
      queryClient.invalidateQueries({ queryKey: productionRunQueryKeys.detail(runId) })
      queryClient.invalidateQueries({ queryKey: productionRunQueryKeys.lists() })
      options?.onSuccess?.(data, variables, _mutateResult, context)
    },
    ...options,
  })
}

export type AdminAttachMediaToRunPayload = {
  media_url: string
  media_mime_type?: string
  filename?: string
  message_id?: string
  conversation_id?: string
}

export const useAttachMediaToRun = (
  runId: string,
  options?: UseMutationOptions<
    { production_run: AdminProductionRun; message: string },
    FetchError,
    AdminAttachMediaToRunPayload
  >
) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: AdminAttachMediaToRunPayload) =>
      sdk.client.fetch<{ production_run: AdminProductionRun; message: string }>(
        `/admin/production-runs/${runId}/attach-media`,
        { method: "POST", body: payload }
      ),
    onSuccess: (data, variables, _mutateResult, context) => {
      queryClient.invalidateQueries({ queryKey: productionRunQueryKeys.detail(runId) })
      queryClient.invalidateQueries({ queryKey: productionRunQueryKeys.lists() })
      options?.onSuccess?.(data, variables, _mutateResult, context)
    },
    ...options,
  })
}
