import { FetchError } from "@medusajs/js-sdk"
import {
  useQuery,
  UseQueryOptions,
  useMutation,
  UseMutationOptions,
  useQueryClient,
  QueryKey,
} from "@tanstack/react-query"
import { sdk } from "../../lib/config"

// ---- Types -----------------------------------------------------------------

export type AdminShareClass = {
  id: string
  name: string
  class_type?: string
  authorized_shares?: number | null
  issued_shares?: number | null
}

export type AdminFundingRound = {
  id: string
  name: string
  round_type?: string
  instrument_type?: "equity" | "safe" | "convertible_note" | "ccps"
  status?: string
  target_amount?: number | null
  raised_amount?: number | null
  pre_money_valuation?: number | null
  post_money_valuation?: number | null
  price_per_share?: number | null
  valuation_cap?: number | null
  discount_rate?: number | null
  safe_type?: "post_money" | "pre_money" | null
  open_date?: string | null
  close_date?: string | null
}

export type AdminStake = {
  id: string
  investor_id?: string | null
  number_of_shares?: number | null
  total_invested?: number | null
  ownership_percentage?: number | null
  status?: string
  investor?: { id: string; name?: string; email?: string } | null
  share_class?: { name?: string } | null
  funding_round?: { name?: string } | null
}

export type AdminCapTable = {
  id: string
  company_id: string
  name: string
  status?: string
  total_shares_authorized?: number | null
  total_shares_issued?: number | null
  total_shares_outstanding?: number | null
  fully_diluted_shares?: number | null
  pre_money_valuation?: number | null
  post_money_valuation?: number | null
  currency_code?: string | null
  share_classes?: AdminShareClass[]
  funding_rounds?: AdminFundingRound[]
  stakes?: AdminStake[]
  created_at?: string
}

export type CompanyCapTablesResponse = {
  cap_tables: AdminCapTable[]
  count: number
}

export type CreateCapTablePayload = {
  name: string
  currency_code?: string
  total_shares_authorized?: number | null
  status?: "draft" | "active" | "archived"
}

export type CreateShareClassPayload = {
  name: string
  class_type?: string
  authorized_shares?: number | null
}

export type CreateFundingRoundPayload = {
  name: string
  round_type?: string
  instrument_type?: "equity" | "safe" | "convertible_note" | "ccps"
  status?: string
  target_amount?: number | null
  pre_money_valuation?: number | null
  price_per_share?: number | null
  valuation_cap?: number | null
  discount_rate?: number | null
  safe_type?: "post_money" | "pre_money" | null
}

// ---- Query keys ------------------------------------------------------------

export const capTablesQueryKeys = {
  companyList: (companyId: string) => ["admin-company-cap-tables", companyId] as const,
  detail: (id: string) => ["admin-cap-table", id] as const,
  stakes: (id: string) => ["admin-cap-table-stakes", id] as const,
}

// ---- Loaders ---------------------------------------------------------------

export const useCompanyCapTables = (
  companyId: string,
  options?: Omit<
    UseQueryOptions<CompanyCapTablesResponse, FetchError, CompanyCapTablesResponse, QueryKey>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () =>
      sdk.client.fetch<CompanyCapTablesResponse>(
        `/admin/companies/${companyId}/cap-tables`,
        { method: "GET" }
      ),
    queryKey: capTablesQueryKeys.companyList(companyId),
    ...options,
  })
  return { ...data, ...rest }
}

export const useCapTable = (
  id: string,
  options?: Omit<
    UseQueryOptions<{ cap_table: AdminCapTable }, FetchError, { cap_table: AdminCapTable }, QueryKey>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () =>
      sdk.client.fetch<{ cap_table: AdminCapTable }>(`/admin/cap-tables/${id}`, {
        method: "GET",
      }),
    queryKey: capTablesQueryKeys.detail(id),
    ...options,
  })
  return { ...data, ...rest }
}

// ---- Mutations -------------------------------------------------------------

export const useCreateCapTable = (
  companyId: string,
  options?: UseMutationOptions<{ cap_table: AdminCapTable }, FetchError, CreateCapTablePayload>
) => {
  const queryClient = useQueryClient()
  return useMutation({
    ...options,
    mutationFn: (payload) =>
      sdk.client.fetch(`/admin/companies/${companyId}/cap-tables`, {
        method: "POST",
        body: payload,
      }),
    onSuccess: (...args: any[]) => {
      queryClient.invalidateQueries({
        queryKey: capTablesQueryKeys.companyList(companyId),
      })
      ;(options?.onSuccess as any)?.(...args)
    },
  })
}

export const useCreateShareClass = (
  capTableId: string,
  options?: UseMutationOptions<{ share_class: AdminShareClass }, FetchError, CreateShareClassPayload>
) => {
  const queryClient = useQueryClient()
  return useMutation({
    ...options,
    mutationFn: (payload) =>
      sdk.client.fetch(`/admin/cap-tables/${capTableId}/share-classes`, {
        method: "POST",
        body: payload,
      }),
    onSuccess: (...args: any[]) => {
      queryClient.invalidateQueries({ queryKey: capTablesQueryKeys.detail(capTableId) })
      // The company-page section renders from the companyList query, not detail —
      // invalidate the whole family so it re-fetches too.
      queryClient.invalidateQueries({ queryKey: ["admin-company-cap-tables"] })
      ;(options?.onSuccess as any)?.(...args)
    },
  })
}

export const useCreateFundingRound = (
  capTableId: string,
  options?: UseMutationOptions<{ funding_round: AdminFundingRound }, FetchError, CreateFundingRoundPayload>
) => {
  const queryClient = useQueryClient()
  return useMutation({
    ...options,
    mutationFn: (payload) =>
      sdk.client.fetch(`/admin/cap-tables/${capTableId}/funding-rounds`, {
        method: "POST",
        body: payload,
      }),
    onSuccess: (...args: any[]) => {
      queryClient.invalidateQueries({ queryKey: capTablesQueryKeys.detail(capTableId) })
      queryClient.invalidateQueries({ queryKey: ["admin-company-cap-tables"] })
      ;(options?.onSuccess as any)?.(...args)
    },
  })
}

export type ProvisionStakePayload = {
  // Existing investor OR a new individual created inline.
  investor_id?: string
  investor?: { name: string; email?: string; investor_type?: "individual" | "entity" | "fund" }
  number_of_shares: number
  share_price?: number | null
  total_invested?: number | null
  share_class_id?: string
  funding_round_id?: string
  status?: "active" | "fully_paid" | "partially_paid" | "unpaid" | "cancelled"
  certificate_number?: string
}

// Manual share provision — allocate a stake directly (bypassing the deal →
// payment flow), optionally creating a bare individual investor inline.
export const useProvisionStake = (
  capTableId: string,
  companyId: string,
  options?: UseMutationOptions<{ stake: AdminStake }, FetchError, ProvisionStakePayload>
) => {
  const queryClient = useQueryClient()
  return useMutation({
    ...options,
    mutationFn: (payload) =>
      sdk.client.fetch(`/admin/cap-tables/${capTableId}/stakes`, {
        method: "POST",
        body: payload,
      }),
    onSuccess: (...args: any[]) => {
      queryClient.invalidateQueries({ queryKey: capTablesQueryKeys.companyList(companyId) })
      queryClient.invalidateQueries({ queryKey: capTablesQueryKeys.detail(capTableId) })
      ;(options?.onSuccess as any)?.(...args)
    },
  })
}

// ---- Deals & participations ------------------------------------------------

export type AdminParticipation = {
  id: string
  // "stake" (equity) or "convertible" (SAFE / note) — set by the participations route.
  type?: "stake" | "convertible"
  investor_id?: string | null
  number_of_shares?: number | null
  total_invested?: number | null
  status?: string
  metadata?: Record<string, any> | null
  investor?: { id: string; name?: string; email?: string } | null
  payments?: Array<{ id: string; amount?: number | null; status?: string; metadata?: Record<string, any> | null }>
  // The issued subscription agreement, if any (null = never issued). `status`
  // is the agreement_response status: sent | viewed | agreed | disagreed | expired.
  agreement?: {
    id: string
    status?: string
    agreed?: boolean
    responded_at?: string | null
    signed_by_admin?: boolean
  } | null
}

export type ConvertibleInstrument = "safe" | "convertible_note" | "ccps"

export type AdminConvertible = {
  id: string
  investor_id?: string | null
  instrument_type?: ConvertibleInstrument
  principal_amount?: number | null
  currency_code?: string | null
  valuation_cap?: number | null
  discount_rate?: number | null
  safe_type?: "post_money" | "pre_money"
  // CCPS-only preference terms.
  num_shares?: number | null
  liquidation_preference_multiple?: number | null
  dividend_rate?: number | null
  conversion_ratio?: number | null
  // Convertible-note-only.
  interest_rate?: number | null
  maturity_date?: string | null
  status?: string
  investment_date?: string | null
  conversion_shares?: number | null
  conversion_price_per_share?: number | null
  metadata?: Record<string, any> | null
  investor?: { id: string; name?: string; email?: string } | null
  payments?: Array<{ id: string; amount?: number | null; status?: string }>
  value?: {
    principal: number
    implied_ownership_pct: number | null
    implied_value: number | null
    multiple: number | null
    basis: string
  }
}

export type ProvisionConvertiblePayload = {
  investor_id?: string
  investor?: { name: string; email?: string; investor_type?: "individual" | "entity" | "fund" }
  instrument_type?: ConvertibleInstrument
  principal_amount: number
  valuation_cap?: number | null
  discount_rate?: number | null
  safe_type?: "post_money" | "pre_money"
  num_shares?: number | null
  liquidation_preference_multiple?: number | null
  dividend_rate?: number | null
  conversion_ratio?: number | null
  interest_rate?: number | null
  maturity_date?: string | null
  investment_date?: string | null
  status?: "outstanding" | "converted" | "redeemed" | "cancelled" | "expired"
  notes?: string | null
}

export type ConvertConvertiblePayload = {
  target?: "equity" | "ccps"
  round_price_per_share?: number | null
  fully_diluted_shares?: number | null
  funding_round_id?: string | null
  share_class_id?: string | null
  shares?: number | null
  price_per_share?: number | null
  conversion_date?: string | null
  liquidation_preference_multiple?: number | null
  dividend_rate?: number | null
  conversion_ratio?: number | null
}

export const convertiblesQueryKey = (capTableId: string) =>
  ["admin-cap-table-convertibles", capTableId] as const

export const useCapTableConvertibles = (
  capTableId: string,
  options?: Omit<
    UseQueryOptions<{ convertibles: AdminConvertible[]; count: number }, FetchError, { convertibles: AdminConvertible[]; count: number }, QueryKey>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () =>
      sdk.client.fetch<{ convertibles: AdminConvertible[]; count: number }>(
        `/admin/cap-tables/${capTableId}/convertibles`,
        { method: "GET" }
      ),
    queryKey: convertiblesQueryKey(capTableId),
    ...options,
  })
  return { ...data, ...rest }
}

// Manual SAFE provision — record a (possibly historical) SAFE for an existing
// investor (or a new individual inline). Mirrors useProvisionStake.
export const useProvisionConvertible = (
  capTableId: string,
  options?: UseMutationOptions<{ convertible: AdminConvertible }, FetchError, ProvisionConvertiblePayload>
) => {
  const queryClient = useQueryClient()
  return useMutation({
    ...options,
    mutationFn: (payload) =>
      sdk.client.fetch(`/admin/cap-tables/${capTableId}/convertibles`, {
        method: "POST",
        body: payload,
      }),
    onSuccess: (...args: any[]) => {
      queryClient.invalidateQueries({ queryKey: convertiblesQueryKey(capTableId) })
      queryClient.invalidateQueries({ queryKey: capTablesQueryKeys.detail(capTableId) })
      queryClient.invalidateQueries({ queryKey: ["admin-company-cap-tables"] })
      ;(options?.onSuccess as any)?.(...args)
    },
  })
}

export const useApproveConvertible = (
  capTableId: string,
  options?: UseMutationOptions<{ payment_id: string; payment_link: string | null }, FetchError, string>
) => {
  const queryClient = useQueryClient()
  return useMutation({
    ...options,
    mutationFn: (convertibleId: string) =>
      sdk.client.fetch(`/admin/convertibles/${convertibleId}/approve`, { method: "POST" }),
    onSuccess: (...args: any[]) => {
      queryClient.invalidateQueries({ queryKey: convertiblesQueryKey(capTableId) })
      queryClient.invalidateQueries({ queryKey: ["admin-round-participations"] })
      ;(options?.onSuccess as any)?.(...args)
    },
  })
}

// Convert an outstanding convertible into equity (a stake) or CCPS shares.
export const useConvertConvertible = (
  capTableId: string,
  options?: UseMutationOptions<
    { target: "equity" | "ccps"; stake?: AdminStake; convertible?: AdminConvertible },
    FetchError,
    { convertibleId: string; payload: ConvertConvertiblePayload }
  >
) => {
  const queryClient = useQueryClient()
  return useMutation({
    ...options,
    mutationFn: ({ convertibleId, payload }) =>
      sdk.client.fetch(`/admin/convertibles/${convertibleId}/convert`, {
        method: "POST",
        body: payload,
      }),
    onSuccess: (...args: any[]) => {
      queryClient.invalidateQueries({ queryKey: convertiblesQueryKey(capTableId) })
      queryClient.invalidateQueries({ queryKey: capTablesQueryKeys.detail(capTableId) })
      queryClient.invalidateQueries({ queryKey: ["admin-company-cap-tables"] })
      ;(options?.onSuccess as any)?.(...args)
    },
  })
}

export const roundParticipationsQueryKey = (roundId: string) =>
  ["admin-round-participations", roundId] as const

export const usePublishRound = (
  capTableId: string,
  options?: UseMutationOptions<{ funding_round: AdminFundingRound }, FetchError, string>
) => {
  const queryClient = useQueryClient()
  return useMutation({
    ...options,
    mutationFn: (roundId: string) =>
      sdk.client.fetch(`/admin/funding-rounds/${roundId}/publish`, { method: "POST" }),
    onSuccess: (...args: any[]) => {
      queryClient.invalidateQueries({ queryKey: capTablesQueryKeys.detail(capTableId) })
      queryClient.invalidateQueries({ queryKey: ["admin-company-cap-tables"] })
      ;(options?.onSuccess as any)?.(...args)
    },
  })
}

// Revise a round's target amount. Server-side guard: only permitted while no
// participant has onboarded on the round (else it 400s).
export const useUpdateRoundTarget = (
  capTableId: string,
  options?: UseMutationOptions<
    { funding_round: AdminFundingRound },
    FetchError,
    { roundId: string; target_amount: number | null }
  >
) => {
  const queryClient = useQueryClient()
  return useMutation({
    ...options,
    mutationFn: ({ roundId, target_amount }) =>
      sdk.client.fetch(`/admin/funding-rounds/${roundId}`, {
        method: "POST",
        body: { target_amount },
      }),
    onSuccess: (...args: any[]) => {
      queryClient.invalidateQueries({ queryKey: capTablesQueryKeys.detail(capTableId) })
      queryClient.invalidateQueries({ queryKey: ["admin-company-cap-tables"] })
      ;(options?.onSuccess as any)?.(...args)
    },
  })
}

export const useRoundParticipations = (
  roundId: string,
  options?: Omit<
    UseQueryOptions<{ participations: AdminParticipation[]; count: number }, FetchError, { participations: AdminParticipation[]; count: number }, QueryKey>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () =>
      sdk.client.fetch<{ participations: AdminParticipation[]; count: number }>(
        `/admin/funding-rounds/${roundId}/participations`,
        { method: "GET" }
      ),
    queryKey: roundParticipationsQueryKey(roundId),
    ...options,
  })
  return { ...data, ...rest }
}

export const useApproveParticipation = (
  roundId: string,
  options?: UseMutationOptions<{ payment_id: string; payment_link: string | null }, FetchError, string>
) => {
  const queryClient = useQueryClient()
  return useMutation({
    ...options,
    mutationFn: (stakeId: string) =>
      sdk.client.fetch(`/admin/stakes/${stakeId}/approve`, { method: "POST" }),
    onSuccess: (...args: any[]) => {
      queryClient.invalidateQueries({ queryKey: roundParticipationsQueryKey(roundId) })
      queryClient.invalidateQueries({ queryKey: ["admin-cap-table"] })
      queryClient.invalidateQueries({ queryKey: ["admin-company-cap-tables"] })
      ;(options?.onSuccess as any)?.(...args)
    },
  })
}

export const useMarkParticipationPaid = (
  roundId: string,
  options?: UseMutationOptions<{ ok: boolean }, FetchError, string>
) => {
  const queryClient = useQueryClient()
  return useMutation({
    ...options,
    mutationFn: (stakeId: string) =>
      sdk.client.fetch(`/admin/stakes/${stakeId}/mark-paid`, { method: "POST" }),
    onSuccess: (...args: any[]) => {
      queryClient.invalidateQueries({ queryKey: roundParticipationsQueryKey(roundId) })
      queryClient.invalidateQueries({ queryKey: ["admin-cap-table"] })
      queryClient.invalidateQueries({ queryKey: ["admin-company-cap-tables"] })
      ;(options?.onSuccess as any)?.(...args)
    },
  })
}

// Settle a SAFE / convertible / CCPS participation manually — completes its
// payment(s). Counterpart to the PayU webhook for the convertible rail (which,
// unlike stakes, has no `fully_paid` instrument state — "paid" lives on the
// Payment). Mirrors useMarkParticipationPaid but hits the convertible route.
export const useMarkConvertiblePaid = (
  roundId: string,
  options?: UseMutationOptions<{ ok: boolean }, FetchError, string>
) => {
  const queryClient = useQueryClient()
  return useMutation({
    ...options,
    mutationFn: (convertibleId: string) =>
      sdk.client.fetch(`/admin/convertibles/${convertibleId}/mark-paid`, {
        method: "POST",
      }),
    onSuccess: (...args: any[]) => {
      queryClient.invalidateQueries({ queryKey: roundParticipationsQueryKey(roundId) })
      queryClient.invalidateQueries({ queryKey: ["admin-cap-table"] })
      queryClient.invalidateQueries({ queryKey: ["admin-cap-table-convertibles"] })
      queryClient.invalidateQueries({ queryKey: ["admin-company-cap-tables"] })
      ;(options?.onSuccess as any)?.(...args)
    },
  })
}

// Issue (or re-fetch) the subscription agreement for a participation — the
// admin counterpart to participate-time issuance, used to backfill agreements
// for participations created before the templates existed. Routes by type
// (stake vs convertible). Idempotent server-side (returns reused: true).
export const useIssueParticipationAgreement = (
  roundId: string,
  options?: UseMutationOptions<
    { response_id: string | null; agreement_url: string | null; reused: boolean },
    FetchError,
    { id: string; type?: "stake" | "convertible" }
  >
) => {
  const queryClient = useQueryClient()
  return useMutation({
    ...options,
    mutationFn: ({ id, type }) =>
      sdk.client.fetch(
        type === "convertible"
          ? `/admin/convertibles/${id}/issue-agreement`
          : `/admin/stakes/${id}/issue-agreement`,
        { method: "POST" }
      ),
    onSuccess: (...args: any[]) => {
      queryClient.invalidateQueries({ queryKey: roundParticipationsQueryKey(roundId) })
      ;(options?.onSuccess as any)?.(...args)
    },
  })
}

// Record an out-of-band signature on an agreement (admin marks it signed /
// declined on the investor's behalf — paper/e-sign done elsewhere). Flagged
// signed_by_admin server-side for the audit trail.
export const useMarkAgreementSigned = (
  roundId: string,
  options?: UseMutationOptions<
    { agreement: { id: string; status: string; agreed: boolean } },
    FetchError,
    { responseId: string; agreed?: boolean; notes?: string; signer_name?: string }
  >
) => {
  const queryClient = useQueryClient()
  return useMutation({
    ...options,
    mutationFn: ({ responseId, ...body }) =>
      sdk.client.fetch(
        `/admin/agreement-responses/${responseId}/mark-signed`,
        { method: "POST", body }
      ),
    onSuccess: (...args: any[]) => {
      queryClient.invalidateQueries({ queryKey: roundParticipationsQueryKey(roundId) })
      ;(options?.onSuccess as any)?.(...args)
    },
  })
}

// Move an equity participation to a non-payment lifecycle state: reject it,
// park it as not-followed-up, or reopen it back to unpaid. Excluded from the
// cap table until (and unless) it becomes fully_paid.
export type ParticipationLifecycleStatus = "rejected" | "not_followed_up" | "unpaid"

export const useSetParticipationStatus = (
  roundId: string,
  options?: UseMutationOptions<
    { ok: boolean; status: string },
    FetchError,
    { stakeId: string; status: ParticipationLifecycleStatus }
  >
) => {
  const queryClient = useQueryClient()
  return useMutation({
    ...options,
    mutationFn: ({ stakeId, status }) =>
      sdk.client.fetch(`/admin/stakes/${stakeId}/set-status`, {
        method: "POST",
        body: { status },
      }),
    onSuccess: (...args: any[]) => {
      queryClient.invalidateQueries({ queryKey: roundParticipationsQueryKey(roundId) })
      queryClient.invalidateQueries({ queryKey: ["admin-cap-table"] })
      queryClient.invalidateQueries({ queryKey: ["admin-company-cap-tables"] })
      ;(options?.onSuccess as any)?.(...args)
    },
  })
}
