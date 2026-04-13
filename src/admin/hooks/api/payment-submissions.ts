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
  design_id: string
  design_name: string | null
  amount: number
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
