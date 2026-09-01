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

/**
 * An id resolved to something a human recognises (#1622). `name` is never an
 * id — a caller that gets no ref shows the id itself.
 */
export interface ResolvedRef {
  id: string
  name: string
  detail?: string | null
}

export interface PaymentSubmissionItem {
  id: string
  /**
   * ⚠️ FOUR values since #1614, not two. This type said `design | task` while
   * the column had offered `run` and `inventory_order` for months — the same
   * two-of-four blindness that made whole payouts render nowhere (#1621).
   */
  source_type: "design" | "task" | "run" | "inventory_order"
  design_id: string | null
  design_name: string | null
  task_id: string | null
  task_name: string | null
  /** Inventory-order and retail-order sources (#1612, #1598). */
  inventory_order_id: string | null
  inventory_order_name: string | null
  order_id: string | null
  /** Resolved by the detail route so the screen shows names, not ULIDs. */
  design?: ResolvedRef | null
  order?: ResolvedRef | null
  inventory_order?: ResolvedRef | null
  runs?: ResolvedRef[]
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
  /** Who is being paid, by name. Resolved by the detail route only (#1622). */
  partner?: ResolvedRef | null
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
  /**
   * Free-text over the submission id.
   *
   * ⚠️ The list query is validated `.strict()`, so an undeclared key is a 400
   * rather than an ignored extra — send only what is here, and omit rather
   * than pass `undefined`.
   */
  q?: string
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
  /**
   * Per-piece price bands per design line (#1596) — "3 × 850 + 1 × 1200".
   *
   * At least two bands: one is an ordinary priced line and belongs in
   * `quantities` + `unit_amounts`. Sent INSTEAD of a `cost_overrides` entry for
   * that design, never alongside one — the workflow refuses two statements of
   * a line total that disagree, and there is no reason to make the screen state
   * it twice.
   */
  rate_breakdown?: Record<string, Array<{ quantity: number; unit_amount: number }>>
  /**
   * GOODS bought from this partner (#1612). Accepted by `create` — with a
   * validator, a partner-ownership guard and read-side resolution — since the
   * guard was written; it was missing from THIS type, so no screen could send
   * one and none did.
   *
   * ⚠️ Send the amount explicitly. Omitting it defaults the server to the raw
   * receipts value, which on an over-delivered order sits ABOVE the ordered
   * total and is refused by `assessInventoryOrderClaims` (#1617).
   */
  inventory_order_lines?: Array<{
    inventory_order_id: string
    amount?: number
    currency?: string
  }>
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
  /**
   * The agreed quantity. Null when the run states NO agreed amount (#1676) —
   * it is open-ended, and the offer is not capped. Distinct from 0.
   */
  ordered_quantity: number | null
  /**
   * #1676 — the run states no agreed quantity: open-ended, and the offer
   * against it is not capped. Read it beside `billable_remaining`, which is
   * null here because there is no ceiling — not because nothing is left.
   */
  open_ended: boolean
  /** Null when output was never recorded — distinct from "made zero". */
  produced_quantity: number | null
  rejected_quantity: number | null
  /**
   * #1596 — set means the run was declared finished for good, so the gap
   * between produced and ordered is settled rather than pending. The offer on
   * the row already reflects it; this is what lets the screen SAY so.
   */
  short_closed_at: string | null
  /**
   * What this row bills for: produced, falling back to ordered — and NEVER
   * above the ordered quantity (#1676), which is the ceiling the write guard
   * enforces. A basis of "ordered" therefore means either "no output recorded"
   * or "the produced figure was capped"; read `produced_quantity` to tell them
   * apart rather than inferring it from the basis.
   */
  payable_quantity: number
  quantity_basis: "produced" | "ordered"
  unit_amount: number
  /**
   * 🔴 Whether `unit_amount` was COMPUTED rather than agreed.
   *
   * True for every `cost_type: "total"` run — 97 of 100 on production — where
   * the rate is `total / quantity` and `unit_amount * quantity` deliberately
   * does NOT reproduce `amount`. A screen that multiplies it anyway bills a
   * figure nobody agreed to: ₹7,777.77 against a ₹10,000 job on a short run,
   * and ₹9,999.99 even on an exact one.
   *
   * ⚠️ The API has always sent this. It was missing from this type, so no
   * screen could read it and none did — the flag existed and had no consumers
   * for as long as it has been sent.
   */
  unit_is_derived: boolean
  /** What is OWED. For a total-priced run this is the agreed total, verbatim. */
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
  /**
   * The EARLIEST live line naming this run, or null.
   *
   * ⚠️ Truthy for a run that has been claimed AT ALL, including one claimed
   * for 1 of the 10 it was ordered for. Never branch on it to decide whether a
   * run may be billed — read `billing_status`, which separates the two.
   */
  billed: {
    submission_id: string
    status: string
    quantity: number
    claimed_quantity: number
    claimed_wholly: boolean
  } | null
  /**
   * The field to branch on, so "we don't know" cannot be spelled the same way
   * as "no" — `billed` | `partly_billed` | `unknown` | `clear`.
   *
   * 🔴 The API has always sent this and this type never declared it, so no
   * admin screen could read it and none did. That is why this screen filtered
   * on `!r.billed` and dropped every partly-billed run, making the #1596 case
   * ("bill 1 of 10 now and the other 9 later") unreachable here while the write
   * guard accepted it and the partner's own screen offered it. Same shape as
   * `unit_is_derived` above: a field sent for months with zero consumers.
   */
  billing_status: "billed" | "partly_billed" | "unknown" | "clear"
  /**
   * Units still billable on this run, or null when there is no arithmetic
   * behind the answer — a claim took the run whole, or the run has no agreed
   * quantity at all (#1676, read `open_ended`). Null is NOT a remainder of
   * zero. A number here is a promise `create` will keep.
   */
  billable_remaining: number | null
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
  /**
   * WHERE the money came from, distinct from `reference_type` (#1614). `mixed`
   * carries a null `source_id` on purpose: a payout naming several sources has
   * no single one to point at.
   */
  source_type: string | null
  source_id: string | null
  /** Resolved by the list route (#1622). Null when there is nothing to name. */
  partner?: ResolvedRef | null
  source?: ResolvedRef | null
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

/**
 * An inventory order a partner may be paid for — GOODS, as opposed to work.
 *
 * `create` has accepted `inventory_order_lines` since #1612, with a validator,
 * a partner-ownership guard and read-side resolution. Nothing ever sent one,
 * because no screen offered them: on production, NO payment carries an
 * `inventory_order_id`.
 */
export interface PayableInventoryOrder {
  inventory_order_id: string
  status: string | null
  is_sample: boolean
  currency_code: string | null
  /**
   * What was ORDERED — and the guard's CEILING. Not what is billed: an order
   * placed for ₹88,885 with ₹28,670 delivered is owed ₹28,670.
   */
  ordered_total: number | null
  /** What the RECEIPTS are worth, before the ceiling is applied. */
  receipts_total: number
  received_quantity: number
  lines: Array<{
    line_id: string
    material_name: string | null
    received: number
    ordered: number
    unit_price: number
    amount: number
  }>
  /** Already billed across every live submission — an order is claimed in tranches. */
  claimed_total: number
  /** What may still be billed; null when the order has no readable price. */
  remaining: number | null
  /** What this row bills if selected: the receipts value, capped at `remaining`. */
  amount: number
  /**
   * ⚠️ Whether `amount` is BELOW `receipts_total` because the ordered total
   * bit. The receipts figure can legitimately exceed what was ordered, and
   * `assessInventoryOrderClaims` refuses that — so the cap is what makes the
   * offer match what the guard accepts (#1617).
   */
  capped_by_ceiling: boolean
  /**
   * Money already PAID against this order (#1710).
   *
   * 🔴 Declare it or the grid cannot read it. The route computes it, and a
   * value sent over the wire with no entry in the client type has ZERO readers
   * — the shape that let an order headline "INR 0 paid" over INR 20,000 of
   * completed payments (#1704), and a flag ship for months unread (#1679).
   */
  recorded_total: number
  /** Whether what has already been paid meets or exceeds what this row bills. */
  recorded_covers_amount: boolean
  order_date: string | null
  expected_delivery_date: string | null
  payable: boolean
  claims: Array<{ submission_id: string | null; status: string | null }>
}

export interface PayableInventoryOrdersResponse {
  payable_inventory_orders: PayableInventoryOrder[]
  count: number
}

export const usePayableInventoryOrders = (
  partnerId: string | undefined,
  options?: Omit<
    UseQueryOptions<
      PayableInventoryOrdersResponse,
      FetchError,
      PayableInventoryOrdersResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () =>
      sdk.client.fetch<PayableInventoryOrdersResponse>(
        `/admin/payment-submissions/payable-inventory-orders`,
        { method: "GET", query: { partner_id: partnerId } }
      ) as Promise<PayableInventoryOrdersResponse>,
    queryKey: paymentSubmissionQueryKeys.list({
      payable_inventory_orders: partnerId,
    }),
    enabled: !!partnerId,
    ...options,
  })
  return {
    payable_inventory_orders: data?.payable_inventory_orders ?? [],
    count: data?.count ?? 0,
    ...rest,
  }
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

/**
 * Attach documents to a payout — at ANY status.
 *
 * The route APPENDS to what it reads, so this sends every file from one drop
 * in a single call: two overlapping requests would each read the same array
 * and the second would silently drop the first's attachments.
 */
export const useAttachPaymentSubmissionDocuments = (
  options?: UseMutationOptions<
    { documents: any[]; added: number },
    FetchError,
    {
      id: string
      documents: Array<{
        id?: string
        url: string
        filename?: string
        mimeType?: string
        size?: number
      }>
    }
  >
) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, documents }) =>
      sdk.client.fetch<{ documents: any[]; added: number }>(
        `/admin/payment-submissions/${id}/documents`,
        { method: "POST", body: { documents } }
      ) as Promise<{ documents: any[]; added: number }>,
    onSuccess: (data, variables, _mutateResult, context) => {
      queryClient.invalidateQueries({ queryKey: paymentSubmissionQueryKeys.lists() })
      queryClient.invalidateQueries({ queryKey: paymentSubmissionQueryKeys.detail(variables.id) })
      options?.onSuccess?.(data, variables, _mutateResult, context)
    },
    ...options,
  })
}

/** Remove one attachment by id. Never by index — the array is re-read on write. */
export const useDeletePaymentSubmissionDocument = (
  options?: UseMutationOptions<
    { documents: any[] },
    FetchError,
    { id: string; document_id: string }
  >
) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, document_id }) =>
      sdk.client.fetch<{ documents: any[] }>(
        `/admin/payment-submissions/${id}/documents?document_id=${encodeURIComponent(document_id)}`,
        { method: "DELETE" }
      ) as Promise<{ documents: any[] }>,
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

/**
 * Correct the NOTE on a payout (#1611).
 *
 * ⚠️ Notes only. The money is the sum of the lines and every path that touches
 * a line re-runs the double-pay guards — `useUpdatePaymentSubmissionItem` is
 * how an amount is corrected.
 */
export const useUpdatePaymentSubmissionNotes = (
  options?: UseMutationOptions<
    { payment_submission: PaymentSubmission },
    FetchError,
    { id: string; notes: string }
  >
) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, notes }) =>
      sdk.client.fetch<{ payment_submission: PaymentSubmission }>(
        `/admin/payment-submissions/${id}`,
        { method: "PATCH", body: { notes } }
      ) as Promise<{ payment_submission: PaymentSubmission }>,
    onSuccess: (data, variables, _mutateResult, context) => {
      queryClient.invalidateQueries({
        queryKey: paymentSubmissionQueryKeys.lists(),
      })
      queryClient.invalidateQueries({
        queryKey: paymentSubmissionQueryKeys.detail(variables.id),
      })
      options?.onSuccess?.(data, variables, _mutateResult, context)
    },
    ...options,
  })
}
