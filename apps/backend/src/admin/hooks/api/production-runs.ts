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
  /**
   * #1596 — short close. Set means "no more will be made": the run's billable
   * ceiling is its PRODUCED quantity from here, not its ordered one.
   * `short_closed_by` is an admin actor id, or the literal "system" when the
   * 30-day counter closed it. `short_closed_quantity` is what produced was
   * believed to be at the moment of the decision — the ceiling itself is always
   * re-derived from the live figure, so a later upward correction is honoured.
   */
  short_closed_at?: string | null
  short_closed_by?: string | null
  short_close_reason?: string | null
  short_closed_quantity?: number | null
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

/**
 * Whether this run has already been billed, and by which payout (#1622).
 *
 * `payable-runs` has always known this and only ever showed it on a screen
 * listing OTHER runs. Same partner-scoped fold behind both, so the run page and
 * the payable list cannot disagree about who holds a run.
 */
export type ProductionRunBilling = {
  run_id: string
  partner_id: string | null
  /** Branch on this — `unknown` is not `clear`. See `runBillingStatus`. */
  billing_status: "billed" | "partly_billed" | "unknown" | "clear"
  claim: {
    submission_id: string
    status: string
    quantity: number
    claimed_quantity: number
    claimed_wholly: boolean
  } | null
  /** Units still billable, or null when there is no arithmetic behind it. */
  billable_remaining: number | null
  unrecorded_claims: Array<{
    submission_id: string
    status: string
    amount: number
  }>
  lines: any[]
}

export const useProductionRunPayments = (
  id: string,
  options?: Omit<
    UseQueryOptions<
      ProductionRunBilling,
      FetchError,
      ProductionRunBilling,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >,
) => {
  const { data, ...rest } = useQuery({
    queryKey: ["production-runs", id, "payments"],
    queryFn: async () =>
      sdk.client.fetch<ProductionRunBilling>(
        `/admin/production-runs/${id}/payments`,
        { method: "GET" },
      ),
    ...options,
  })
  return { ...data, ...rest }
}

/**
 * SHORT CLOSE (#1596) — "no more will be made on this run."
 *
 * A run ordered for 9 and completed at 7 keeps 2 units billable, deliberately:
 * output is captured at completion and a run can legitimately produce more
 * afterwards. That headroom cannot tell "not made yet" from "never will be
 * made", and this is the statement that settles it. From here the run bills to
 * what it PRODUCED.
 *
 * 🔑 Invalidate the billing key too. The remainder shown beside "Partly billed"
 * is computed by `/payments` from the same ceiling this moves, and a screen
 * still offering units the write guard now refuses is how an admin learns about
 * a rule from a 400.
 */
const invalidateRunBilling = (queryClient: ReturnType<typeof useQueryClient>, runId: string) => {
  queryClient.invalidateQueries({ queryKey: productionRunQueryKeys.detail(runId) })
  queryClient.invalidateQueries({ queryKey: productionRunQueryKeys.lists() })
  queryClient.invalidateQueries({ queryKey: ["production-runs", runId, "payments"] })
  queryClient.invalidateQueries({ queryKey: ["payable-runs"] })
}

export type AdminShortCloseRunPayload = {
  reason?: string | null
}

export type AdminShortCloseRunResponse = {
  production_run: AdminProductionRun
  short_closed: boolean
  /** `closed`, or `already_closed` when a repeat call found nothing to do. */
  outcome: string
}

export const useShortCloseProductionRun = (
  runId: string,
  options?: UseMutationOptions<
    AdminShortCloseRunResponse,
    FetchError,
    AdminShortCloseRunPayload
  >
) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: AdminShortCloseRunPayload) =>
      sdk.client.fetch<AdminShortCloseRunResponse>(
        `/admin/production-runs/${runId}/short-close`,
        { method: "POST", body: payload }
      ),
    onSuccess: (data, variables, _mutateResult, context) => {
      invalidateRunBilling(queryClient, runId)
      queryClient.invalidateQueries({
        queryKey: [...productionRunQueryKeys.detail(runId), "activities"],
      })
      options?.onSuccess?.(data, variables, _mutateResult, context)
    },
    ...options,
  })
}

export type AdminReopenRunResponse = {
  production_run: AdminProductionRun
  reopened: boolean
}

/**
 * Reverse a short close — it was premature, or more work is coming.
 *
 * Reversal is always available; closing never is automatic on this screen. An
 * upward output correction also reopens a closed run on the server, so this is
 * the deliberate path rather than the only one.
 */
export const useReopenProductionRun = (
  runId: string,
  options?: UseMutationOptions<AdminReopenRunResponse, FetchError, AdminShortCloseRunPayload | void>
) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: AdminShortCloseRunPayload | void) =>
      sdk.client.fetch<AdminReopenRunResponse>(
        `/admin/production-runs/${runId}/short-close`,
        { method: "DELETE", body: payload || {} }
      ),
    onSuccess: (data, variables, _mutateResult, context) => {
      invalidateRunBilling(queryClient, runId)
      queryClient.invalidateQueries({
        queryKey: [...productionRunQueryKeys.detail(runId), "activities"],
      })
      options?.onSuccess?.(data, variables, _mutateResult, context)
    },
    ...options,
  })
}
