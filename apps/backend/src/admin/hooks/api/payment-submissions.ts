import { FetchError } from "@medusajs/js-sdk"
import {
  useQuery,
  UseQueryOptions,
  QueryKey,
  useMutation,
  UseMutationOptions,
  useQueryClient,
} from "@tanstack/react-query"
import { sdk } from "../../lib/config"
import { queryKeysFactory } from "../../lib/query-key-factory"

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PaymentSubmissionItem {
  id: string
  source_type: "design" | "task"
  design_id: string | null
  design_name: string | null
  task_id: string | null
  task_name: string | null
  amount: number
  /** Units this line pays for, and the rate behind them. `unit_amount` is null
   *  when the total was typed rather than derived — see resolveDesignLineAmount. */
  quantity: number
  unit_amount: number | null
  /** The runs this line pays for, and whether that is known at all (#1565). */
  production_run_ids: string[] | null
  run_provenance: "recorded" | "no_run" | "not_recorded"
  cost_breakdown: any
  metadata: any
  created_at: string
}

export interface PaymentSubmission {
  id: string
  partner_id: string
  status: "Draft" | "Pending" | "Under_Review" | "Approved" | "Rejected" | "Paid"
  total_amount: number
  currency: string
  submitted_at: string | null
  reviewed_at: string | null
  reviewed_by: string | null
  rejection_reason: string | null
  notes: string | null
  documents: Array<{ id?: string; url: string; filename?: string; mimeType?: string }> | null
  metadata: any
  items: PaymentSubmissionItem[]
  created_at: string
  updated_at: string
}

export interface PaymentSubmissionsListResponse {
  payment_submissions: PaymentSubmission[]
  count: number
  offset: number
  limit: number
}

export interface PaymentSubmissionsQuery {
  status?: string
  partner_id?: string
  limit?: number
  offset?: number
}

export interface ReviewPaymentSubmissionPayload {
  action: "approve" | "reject"
  rejection_reason?: string
  amount_override?: number
  payment_type?: "Bank" | "Cash" | "Digital_Wallet"
  paid_to_id?: string
  notes?: string
}

export interface CreateAdminPaymentSubmissionPayload {
  partner_id: string
  design_ids?: string[]
  task_ids?: string[]
  notes?: string
  documents?: Array<{ id?: string; url: string; filename?: string; mimeType?: string }>
  /**
   * The money contract, keyed by design id (or task id for the last one).
   *
   * 🔴 Typed fields rather than `metadata` keys: these decide what a partner is
   * paid, and the route validates `metadata` as `z.record(z.string(), z.any())`
   * — so a mistyped key validated cleanly, fell through to the workflow's
   * "absent means 1" default, and billed a per-unit rate once (#1554).
   */
  quantities?: Record<string, number>
  unit_amounts?: Record<string, number>
  cost_overrides?: Record<string, number>
  task_cost_overrides?: Record<string, number>
  /** Admin-only: land the submission as a Draft rather than Pending. */
  status?: "Draft" | "Pending"
  /**
   * Admin-only: waive the design-status gate. The proof of finished work is a
   * completed run, which is why the run-completion auto-draft already passes
   * false — without this the only way to pay out a finished run on a design
   * still in Technical_Review was to edit the design's status.
   */
  require_design_status?: boolean
  /**
   * Which completed runs each design line pays for, keyed by design id.
   *
   * 🔴 Typed, and deliberately not folded into `metadata` — this is what stops
   * the same finished run being paid for twice, and a guard reading an untyped
   * blob is one spelling mistake away from reading nothing.
   */
  production_run_ids?: Record<string, string[]>
  metadata?: Record<string, any>
}

/**
 * One completed production run a partner can be paid for.
 *
 * 🔑 A RUN, not a design. The rate and the piece count live on the run; a
 * design is a recipe that has been produced many times, and pricing off it
 * bills a per-unit figure once (#1554).
 */
export interface PayableRun {
  run_id: string
  design_id: string
  design_name: string | null
  design_status: string | null
  completed_at: string | null
  ordered_quantity: number | null
  /** Null when output was never recorded — distinct from "made zero". */
  produced_quantity: number | null
  rejected_quantity: number | null
  /** What this row bills for: produced, falling back to ordered. */
  payable_quantity: number
  quantity_basis: "produced" | "ordered"
  unit_amount: number
  amount: number
  cost_type: "per_unit" | "total" | null
  partner_cost_estimate: number | null
  /**
   * Whether the RUN carries an agreed rate. NOT "can this be paid" — an
   * unpriced run is still payable by typing the rate. Only `billed` blocks.
   */
  payable: boolean
  /** The design's own cost, offered as a starting point. A suggestion, never a price. */
  design_estimated_cost: number | null
  design_production_cost: number | null
  billed: { submission_id: string; status: string; quantity: number } | null
  design_has_open_submission: boolean
}

export interface PayableRunsResponse {
  payable_runs: PayableRun[]
  count: number
}

// ─── Reconciliation Types ───────────────────────────────────────────────────

export interface PaymentReconciliation {
  id: string
  reference_type: "payment_submission" | "inventory_order" | "manual"
  reference_id: string | null
  partner_id: string | null
  expected_amount: number
  actual_amount: number | null
  discrepancy: number | null
  status: "Pending" | "Matched" | "Discrepant" | "Settled" | "Waived"
  payment_id: string | null
  settled_at: string | null
  settled_by: string | null
  notes: string | null
  metadata: any
  created_at: string
  updated_at: string
}

export interface ReconciliationsListResponse {
  reconciliations: PaymentReconciliation[]
  count: number
  offset: number
  limit: number
}

export interface ReconciliationsQuery {
  status?: string
  partner_id?: string
  reference_type?: string
  period_start?: string
  period_end?: string
  limit?: number
  offset?: number
}

export interface CreateReconciliationPayload {
  reference_type: "payment_submission" | "inventory_order" | "manual"
  reference_id?: string
  partner_id?: string
  expected_amount: number
  actual_amount?: number
  payment_id?: string
  notes?: string
  metadata?: Record<string, any>
}

export interface UpdateReconciliationPayload {
  id: string
  actual_amount?: number
  status?: string
  notes?: string
  metadata?: Record<string, any>
}

// ─── Query Keys ─────────────────────────────────────────────────────────────

const SUBMISSIONS_QUERY_KEY = "payment_submissions" as const
export const paymentSubmissionQueryKeys = queryKeysFactory(SUBMISSIONS_QUERY_KEY)

const RECONCILIATIONS_QUERY_KEY = "payment_reconciliations" as const
export const reconciliationQueryKeys = queryKeysFactory(RECONCILIATIONS_QUERY_KEY)

// ─── Payment Submissions Hooks ──────────────────────────────────────────────

export const usePaymentSubmissions = (
  query?: PaymentSubmissionsQuery,
  options?: Omit<
    UseQueryOptions<PaymentSubmissionsListResponse, FetchError, PaymentSubmissionsListResponse, QueryKey>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () =>
      sdk.client.fetch<PaymentSubmissionsListResponse>(`/admin/payment-submissions`, {
        method: "GET",
        query: query ?? {},
      }) as Promise<PaymentSubmissionsListResponse>,
    queryKey: paymentSubmissionQueryKeys.list(query),
    ...options,
  })
  return { ...data, ...rest }
}

/**
 * The completed runs a partner can be paid for.
 *
 * Disabled until a partner is chosen — the endpoint REQUIRES `partner_id`
 * (an unfiltered variant would list every completed run on the platform), so
 * firing it early is a guaranteed 400 rather than an empty list.
 */
export const usePayableRuns = (
  partnerId: string | undefined,
  options?: Omit<
    UseQueryOptions<PayableRunsResponse, FetchError, PayableRunsResponse, QueryKey>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () =>
      sdk.client.fetch<PayableRunsResponse>(
        `/admin/payment-submissions/payable-runs`,
        { method: "GET", query: { partner_id: partnerId } }
      ) as Promise<PayableRunsResponse>,
    queryKey: paymentSubmissionQueryKeys.list({ payable_runs: partnerId }),
    enabled: !!partnerId,
    ...options,
  })
  return { payable_runs: data?.payable_runs ?? [], count: data?.count ?? 0, ...rest }
}

export const usePaymentSubmission = (
  id: string,
  options?: Omit<
    UseQueryOptions<{ payment_submission: PaymentSubmission }, FetchError, { payment_submission: PaymentSubmission }, QueryKey>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () =>
      sdk.client.fetch<{ payment_submission: PaymentSubmission }>(`/admin/payment-submissions/${id}`, {
        method: "GET",
      }) as Promise<{ payment_submission: PaymentSubmission }>,
    queryKey: paymentSubmissionQueryKeys.detail(id),
    enabled: !!id,
    ...options,
  })
  return { ...data, ...rest }
}

export const useReviewPaymentSubmission = (
  options?: UseMutationOptions<
    { payment_submission: PaymentSubmission; payment: any },
    FetchError,
    { id: string } & ReviewPaymentSubmissionPayload
  >
) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...payload }: { id: string } & ReviewPaymentSubmissionPayload) =>
      sdk.client.fetch<{ payment_submission: PaymentSubmission; payment: any }>(
        `/admin/payment-submissions/${id}/review`,
        { method: "POST", body: payload }
      ) as Promise<{ payment_submission: PaymentSubmission; payment: any }>,
    onSuccess: (data, variables, _mutateResult, context) => {
      queryClient.invalidateQueries({ queryKey: paymentSubmissionQueryKeys.lists() })
      queryClient.invalidateQueries({ queryKey: paymentSubmissionQueryKeys.detail(variables.id) })
      queryClient.invalidateQueries({ queryKey: reconciliationQueryKeys.lists() })
      options?.onSuccess?.(data, variables, _mutateResult, context)
    },
    ...options,
  })
}

export const useCreatePaymentSubmission = (
  options?: UseMutationOptions<
    { payment_submission: PaymentSubmission },
    FetchError,
    CreateAdminPaymentSubmissionPayload
  >
) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: CreateAdminPaymentSubmissionPayload) =>
      sdk.client.fetch<{ payment_submission: PaymentSubmission }>(
        `/admin/payment-submissions`,
        { method: "POST", body: payload }
      ) as Promise<{ payment_submission: PaymentSubmission }>,
    onSuccess: (data, variables, _mutateResult, context) => {
      queryClient.invalidateQueries({ queryKey: paymentSubmissionQueryKeys.lists() })
      options?.onSuccess?.(data, variables, _mutateResult, context)
    },
    ...options,
  })
}

/**
 * Draft → Pending, in place (#1604).
 *
 * Until this route existed the only exit from a Draft was a partner creating a
 * SECOND submission by hand — which could not name the runs the Draft already
 * claimed, so it named none and threw the evidence away. Seven production
 * Drafts are still waiting on it.
 */
export const useSubmitPaymentSubmission = (
  options?: UseMutationOptions<
    { payment_submission: PaymentSubmission },
    FetchError,
    { id: string; notes?: string }
  >
) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...payload }: { id: string; notes?: string }) =>
      sdk.client.fetch<{ payment_submission: PaymentSubmission }>(
        `/admin/payment-submissions/${id}/submit`,
        { method: "POST", body: payload }
      ) as Promise<{ payment_submission: PaymentSubmission }>,
    onSuccess: (data, variables, _mutateResult, context) => {
      queryClient.invalidateQueries({ queryKey: paymentSubmissionQueryKeys.lists() })
      queryClient.invalidateQueries({ queryKey: paymentSubmissionQueryKeys.detail(variables.id) })
      options?.onSuccess?.(data, variables, _mutateResult, context)
    },
    ...options,
  })
}

/**
 * Correct one line (#1604). Honoured on Draft and Pending only — the money on
 * anything later has moved or been committed.
 *
 * 🔴 `production_run_ids` re-runs the full double-pay guard server-side. Do not
 * add a client-side shortcut around it.
 */
export const useUpdatePaymentSubmissionItem = (
  options?: UseMutationOptions<
    { payment_submission: PaymentSubmission },
    FetchError,
    {
      id: string
      item_id: string
      quantity?: number
      unit_amount?: number
      amount?: number
      production_run_ids?: string[]
      metadata?: Record<string, any>
    }
  >
) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, item_id, ...payload }) =>
      sdk.client.fetch<{ payment_submission: PaymentSubmission }>(
        `/admin/payment-submissions/${id}/items/${item_id}`,
        { method: "PATCH", body: payload }
      ) as Promise<{ payment_submission: PaymentSubmission }>,
    onSuccess: (data, variables, _mutateResult, context) => {
      queryClient.invalidateQueries({ queryKey: paymentSubmissionQueryKeys.lists() })
      queryClient.invalidateQueries({ queryKey: paymentSubmissionQueryKeys.detail(variables.id) })
      options?.onSuccess?.(data, variables, _mutateResult, context)
    },
    ...options,
  })
}

/** Remove a machine-written Draft (#1604). Draft only — the route refuses the rest. */
export const useDeletePaymentSubmission = (
  options?: UseMutationOptions<
    { id: string; deleted: boolean },
    FetchError,
    { id: string }
  >
) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id }: { id: string }) =>
      sdk.client.fetch<{ id: string; deleted: boolean }>(
        `/admin/payment-submissions/${id}`,
        { method: "DELETE" }
      ) as Promise<{ id: string; deleted: boolean }>,
    onSuccess: (data, variables, _mutateResult, context) => {
      queryClient.invalidateQueries({ queryKey: paymentSubmissionQueryKeys.lists() })
      queryClient.invalidateQueries({ queryKey: paymentSubmissionQueryKeys.detail(variables.id) })
      options?.onSuccess?.(data, variables, _mutateResult, context)
    },
    ...options,
  })
}

// ─── Reconciliation Hooks ───────────────────────────────────────────────────

export const useReconciliations = (
  query?: ReconciliationsQuery,
  options?: Omit<
    UseQueryOptions<ReconciliationsListResponse, FetchError, ReconciliationsListResponse, QueryKey>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () =>
      sdk.client.fetch<ReconciliationsListResponse>(`/admin/payment_reports/reconciliation`, {
        method: "GET",
        query: query ?? {},
      }) as Promise<ReconciliationsListResponse>,
    queryKey: reconciliationQueryKeys.list(query),
    ...options,
  })
  return { ...data, ...rest }
}

export const useReconciliation = (
  id: string,
  options?: Omit<
    UseQueryOptions<{ reconciliation: PaymentReconciliation }, FetchError, { reconciliation: PaymentReconciliation }, QueryKey>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () =>
      sdk.client.fetch<{ reconciliation: PaymentReconciliation }>(
        `/admin/payment_reports/reconciliation/${id}`,
        { method: "GET" }
      ) as Promise<{ reconciliation: PaymentReconciliation }>,
    queryKey: reconciliationQueryKeys.detail(id),
    enabled: !!id,
    ...options,
  })
  return { ...data, ...rest }
}

export const useCreateReconciliation = (
  options?: UseMutationOptions<{ reconciliation: PaymentReconciliation }, FetchError, CreateReconciliationPayload>
) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: CreateReconciliationPayload) =>
      sdk.client.fetch<{ reconciliation: PaymentReconciliation }>(
        `/admin/payment_reports/reconciliation`,
        { method: "POST", body: payload }
      ) as Promise<{ reconciliation: PaymentReconciliation }>,
    onSuccess: (data, variables, _mutateResult, context) => {
      queryClient.invalidateQueries({ queryKey: reconciliationQueryKeys.lists() })
      options?.onSuccess?.(data, variables, _mutateResult, context)
    },
    ...options,
  })
}

export const useUpdateReconciliation = (
  options?: UseMutationOptions<{ reconciliation: PaymentReconciliation }, FetchError, UpdateReconciliationPayload>
) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...data }: UpdateReconciliationPayload) =>
      sdk.client.fetch<{ reconciliation: PaymentReconciliation }>(
        `/admin/payment_reports/reconciliation/${id}`,
        { method: "PATCH", body: data }
      ) as Promise<{ reconciliation: PaymentReconciliation }>,
    onSuccess: (data, variables, _mutateResult, context) => {
      queryClient.invalidateQueries({ queryKey: reconciliationQueryKeys.lists() })
      queryClient.invalidateQueries({ queryKey: reconciliationQueryKeys.detail(variables.id) })
      options?.onSuccess?.(data, variables, _mutateResult, context)
    },
    ...options,
  })
}

export const useSettleReconciliation = (
  options?: UseMutationOptions<{ reconciliation: PaymentReconciliation }, FetchError, { id: string; notes?: string }>
) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...data }: { id: string; notes?: string }) =>
      sdk.client.fetch<{ reconciliation: PaymentReconciliation }>(
        `/admin/payment_reports/reconciliation/${id}/settle`,
        { method: "POST", body: data }
      ) as Promise<{ reconciliation: PaymentReconciliation }>,
    onSuccess: (data, variables, _mutateResult, context) => {
      queryClient.invalidateQueries({ queryKey: reconciliationQueryKeys.lists() })
      queryClient.invalidateQueries({ queryKey: reconciliationQueryKeys.detail(variables.id) })
      options?.onSuccess?.(data, variables, _mutateResult, context)
    },
    ...options,
  })
}

// ─── Partner Payment Methods (for review drawer) ──────────────────────────

export interface PartnerPaymentMethod {
  id: string
  type: "bank_account" | "cash_account" | "digital_wallet"
  account_name: string
  account_number?: string | null
  bank_name?: string | null
  ifsc_code?: string | null
  wallet_id?: string | null
}

const PARTNER_PAYMENT_METHODS_QUERY_KEY = "partner_payment_methods" as const
export const partnerPaymentMethodsQueryKeys = queryKeysFactory(PARTNER_PAYMENT_METHODS_QUERY_KEY)

export const usePartnerPaymentMethods = (
  partnerId: string,
  options?: Omit<
    UseQueryOptions<
      { paymentMethods: PartnerPaymentMethod[]; count: number },
      FetchError,
      { paymentMethods: PartnerPaymentMethod[]; count: number },
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () =>
      sdk.client.fetch<{ paymentMethods: PartnerPaymentMethod[]; count: number }>(
        `/admin/payments/partners/${partnerId}/methods`,
        { method: "GET" }
      ),
    queryKey: partnerPaymentMethodsQueryKeys.detail(partnerId),
    enabled: !!partnerId,
    ...options,
  })

  return {
    paymentMethods: data?.paymentMethods || [],
    count: data?.count || 0,
    ...rest,
  }
}
