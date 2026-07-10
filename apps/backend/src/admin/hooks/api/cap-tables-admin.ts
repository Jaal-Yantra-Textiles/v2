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
  status?: string
  target_amount?: number | null
  raised_amount?: number | null
  pre_money_valuation?: number | null
  post_money_valuation?: number | null
  price_per_share?: number | null
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
  status?: string
  target_amount?: number | null
  pre_money_valuation?: number | null
  price_per_share?: number | null
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
      ;(options?.onSuccess as any)?.(...args)
    },
  })
}

// ---- Deals & participations ------------------------------------------------

export type AdminParticipation = {
  id: string
  investor_id?: string | null
  number_of_shares?: number | null
  total_invested?: number | null
  status?: string
  metadata?: Record<string, any> | null
  investor?: { id: string; name?: string; email?: string } | null
  payments?: Array<{ id: string; amount?: number | null; status?: string; metadata?: Record<string, any> | null }>
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
