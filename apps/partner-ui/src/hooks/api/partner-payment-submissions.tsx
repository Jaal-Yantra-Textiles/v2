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

const PARTNER_PAYMENT_SUBMISSIONS_QUERY_KEY = "partner-payment-submissions" as const
export const partnerPaymentSubmissionsQueryKeys = queryKeysFactory(
  PARTNER_PAYMENT_SUBMISSIONS_QUERY_KEY
)

// ─── Types ──────────────────────────────────────────────────────────────────

export type PaymentSubmissionItem = {
  id: string
  design_id: string
  design_name: string | null
  amount: number
  cost_breakdown: any
  metadata: any
  created_at: string
}

export type PaymentSubmission = {
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

export type PaymentSubmissionListResponse = {
  payment_submissions: PaymentSubmission[]
  count: number
  offset: number
  limit: number
}

export type ListPaymentSubmissionsParams = {
  status?: string
  limit?: number
  offset?: number
}

export type CreatePaymentSubmissionPayload = {
  design_ids: string[]
  notes?: string
  documents?: Array<{ id?: string; url: string; filename?: string; mimeType?: string }>
  metadata?: Record<string, any>
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const buildQuery = (params?: Record<string, any>) => {
  const query = qs.stringify(params || {}, { skipNulls: true })
  return query ? `?${query}` : ""
}

// ─── Hooks ──────────────────────────────────────────────────────────────────

export const usePartnerPaymentSubmissions = (
  params?: ListPaymentSubmissionsParams,
  options?: Omit<
    UseQueryOptions<
      PaymentSubmissionListResponse,
      FetchError,
      PaymentSubmissionListResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: partnerPaymentSubmissionsQueryKeys.list(params),
    queryFn: async () => {
      const q = buildQuery(params)
      return await sdk.client.fetch<PaymentSubmissionListResponse>(
        `/partners/payment-submissions${q}`,
        { method: "GET" }
      )
    },
    ...options,
  })

  return {
    ...data,
    payment_submissions: data?.payment_submissions ?? [],
    ...rest,
  }
}

export const usePartnerPaymentSubmission = (
  submissionId: string,
  options?: Omit<
    UseQueryOptions<
      { payment_submission: PaymentSubmission },
      FetchError,
      { payment_submission: PaymentSubmission },
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: partnerPaymentSubmissionsQueryKeys.detail(submissionId),
    queryFn: async () =>
      await sdk.client.fetch<{ payment_submission: PaymentSubmission }>(
        `/partners/payment-submissions/${submissionId}`,
        { method: "GET" }
      ),
    enabled: !!submissionId,
    ...options,
  })

  return {
    payment_submission: data?.payment_submission,
    ...rest,
  }
}

export const useCreatePartnerPaymentSubmission = (
  options?: UseMutationOptions<
    { payment_submission: PaymentSubmission },
    FetchError,
    CreatePaymentSubmissionPayload
  >
) => {
  return useMutation({
    mutationFn: async (payload: CreatePaymentSubmissionPayload) =>
      await sdk.client.fetch<{ payment_submission: PaymentSubmission }>(
        `/partners/payment-submissions`,
        { method: "POST", body: payload }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: partnerPaymentSubmissionsQueryKeys.lists(),
      })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}
