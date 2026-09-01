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
  source_type: "design" | "task"
  design_id: string | null
  design_name: string | null
  task_id: string | null
  task_name: string | null
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
  design_ids?: string[]
  task_ids?: string[]
  notes?: string
  documents?: Array<{ id?: string; url: string; filename?: string; mimeType?: string }>
  /**
   * The money contract, keyed by design id (task id for the last one).
   *
   * 🔴 Typed fields rather than `metadata` keys: these decide what the partner
   * is paid, and the route validated `metadata` as
   * `z.record(z.string(), z.any())` — so a mistyped key validated cleanly and
   * then silently priced the line off the design's stored cost instead of the
   * amount actually entered.
   *
   * ⚠️ No `status` / `require_design_status` here, unlike the admin payload:
   * a partner may not choose which review state their own claim lands in, nor
   * waive the design-eligibility gate on it.
   */
  quantities?: Record<string, number>
  unit_amounts?: Record<string, number>
  cost_overrides?: Record<string, number>
  task_cost_overrides?: Record<string, number>
  /**
   * WHICH completed runs each design line pays for, keyed by design id.
   *
   * 🔑 Not money, but the PROVENANCE of money — it is what stops the same
   * finished run being paid for twice (#1556/#1565). Untyped here, the runs
   * screen still SENT it (the mutation passes the body straight through) while
   * tsc reported the field as unknown, which is precisely the "typed layer that
   * isn't the contract" shape #1571 exists to close.
   */
  production_run_ids?: Record<string, string[]>
  /**
   * Per-piece price bands per design line (#1596) — "3 × 850 + 1 × 1200".
   *
   * At least two bands, sent INSTEAD of a `cost_overrides` entry for that
   * design: two statements of one line total must agree or the request is
   * refused, and the bands already carry the total.
   */
  rate_breakdown?: Record<string, Array<{ quantity: number; unit_amount: number }>>
  /**
   * Payout lines sourced from INVENTORY ORDERS — goods we bought from this
   * partner, as opposed to work they did for us (#1710).
   *
   * 🔴 Declared here or the screen cannot send it. The mutation passes the body
   * straight through, so an undeclared field type-errors at the call site while
   * the request would have worked — and the reverse (a field the client sends
   * that no type declares) is how a flag shipped for months with zero readers
   * (#1679). One order per entry; the workflow refuses a repeated order id.
   *
   * ⚠️ Send `amount` ONLY when a human typed one. Absent means "value it from
   * the recorded receipts", which is the server's job and the one place that
   * arithmetic lives.
   */
  inventory_order_lines?: Array<{
    inventory_order_id: string
    amount?: number
    currency?: string
  }>
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
    // Forward whatever arity the installed react-query types expect. Spelling
    // the three parameters out hardcoded an older signature and tripped
    // TS2554 ("expected 4 arguments, but got 3") — a pre-existing error, fixed
    // here because the changed-files type gate requires a file this PR touches
    // to come back clean.
    onSuccess: (
      ...args: Parameters<NonNullable<NonNullable<typeof options>["onSuccess"]>>
    ) => {
      queryClient.invalidateQueries({
        queryKey: partnerPaymentSubmissionsQueryKeys.lists(),
      })
      options?.onSuccess?.(...args)
    },
    ...options,
  })
}

/**
 * Turn one of this partner's Drafts into a real claim (#1604).
 *
 * `auto-draft-payment-submission` pre-fills a submission on every completed
 * run — the design, the rate, the quantity AND the run ids — and until this
 * route existed there was no way to submit it. The documented workaround was to
 * create a second submission by hand naming NO runs, which threw the run
 * evidence away and is precisely the claim the double-pay guard cannot tell
 * apart from an earlier one. Converting in place keeps the evidence.
 */
export const useSubmitPartnerPaymentSubmission = (
  options?: UseMutationOptions<
    { payment_submission: PaymentSubmission },
    FetchError,
    { submissionId: string; notes?: string }
  >
) => {
  return useMutation({
    mutationFn: async ({
      submissionId,
      ...payload
    }: {
      submissionId: string
      notes?: string
    }) =>
      await sdk.client.fetch<{ payment_submission: PaymentSubmission }>(
        `/partners/payment-submissions/${submissionId}/submit`,
        { method: "POST", body: payload }
      ),
    onSuccess: (
      ...args: Parameters<NonNullable<NonNullable<typeof options>["onSuccess"]>>
    ) => {
      queryClient.invalidateQueries({
        queryKey: partnerPaymentSubmissionsQueryKeys.lists(),
      })
      queryClient.invalidateQueries({
        queryKey: partnerPaymentSubmissionsQueryKeys.detail(
          args[1].submissionId
        ),
      })
      options?.onSuccess?.(...args)
    },
    ...options,
  })
}
