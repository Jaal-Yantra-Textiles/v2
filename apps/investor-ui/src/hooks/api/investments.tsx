import { FetchError } from "@medusajs/js-sdk"
import {
  useMutation,
  UseMutationOptions,
  useQuery,
} from "@tanstack/react-query"
import { sdk } from "../../lib/client"
import { queryClient } from "../../lib/query-client"

// Investor-facing deals (open funding rounds) + participations.

export type Deal = {
  id: string
  name: string
  round_type?: string
  instrument_type?: "equity" | "safe" | "convertible_note"
  status?: string
  target_amount?: number | null
  raised_amount?: number | null
  price_per_share?: number | null
  pre_money_valuation?: number | null
  valuation_cap?: number | null
  discount_rate?: number | null
  safe_type?: "post_money" | "pre_money" | null
  close_date?: string | null
  cap_table?: { company_id?: string; name?: string; currency_code?: string | null } | null
}

export const isSafeDeal = (d: Deal) =>
  d.instrument_type === "safe" ||
  d.instrument_type === "convertible_note" ||
  d.round_type === "safe"

export type Participation = {
  id: string
  number_of_shares?: number | null
  total_invested?: number | null
  status?: string
  funding_round?: { name?: string; round_type?: string } | null
  cap_table?: { name?: string; company_id?: string } | null
  payments?: Array<{
    id: string
    amount?: number | null
    status?: string
    metadata?: Record<string, any> | null
  }>
}

export type CapTableStake = {
  id: string
  investor_id?: string | null
  total_invested?: number | null
  number_of_shares?: number | null
  status?: string
  is_me?: boolean
  investor?: { id?: string; name?: string } | null
  funding_round?: { name?: string } | null
  share_class?: { name?: string } | null
}

export type InvestorCapTable = {
  id: string
  name: string
  company_id?: string
  currency_code?: string | null
  total_shares_authorized?: number | null
  pre_money_valuation?: number | null
  post_money_valuation?: number | null
  share_classes?: Array<{ id: string; name: string; class_type?: string }>
  funding_rounds?: Array<{ id: string; name: string; status?: string; round_type?: string }>
  stakes?: CapTableStake[]
}

export const investmentsQueryKeys = {
  deals: ["investor-deals"] as const,
  participations: ["investor-participations"] as const,
  capTable: ["investor-cap-table"] as const,
}

export type InvestorDocument = {
  id: string
  title: string
  description?: string | null
  document_type?: string
  file_url?: string | null
  file_name?: string | null
  visibility?: string
  company_id?: string
  created_at?: string
}

export const useMyDocuments = () => {
  const { data, ...rest } = useQuery({
    queryFn: () =>
      sdk.client.fetch<{ documents: InvestorDocument[]; count: number }>(
        "/investors/me/documents",
        { method: "GET" }
      ),
    queryKey: ["investor-documents"] as const,
  })
  return { documents: data?.documents ?? [], count: data?.count ?? 0, ...rest }
}

// --- SAFEs / convertibles (money in now, equity later — no shares yet) --------

export type ConvertibleValue = {
  principal: number
  implied_ownership_pct: number | null
  implied_value: number | null
  multiple: number | null
  basis: string
}

export type MyConvertible = {
  id: string
  instrument_type?: "safe" | "convertible_note" | "ccps"
  principal_amount?: number | null
  currency_code?: string | null
  valuation_cap?: number | null
  discount_rate?: number | null
  safe_type?: "post_money" | "pre_money"
  // CCPS-only preference terms.
  num_shares?: number | null
  liquidation_preference_multiple?: number | null
  status?: string
  investment_date?: string | null
  conversion_date?: string | null
  cap_table?: {
    id?: string
    name?: string
    company_id?: string
    post_money_valuation?: number | null
    currency_code?: string | null
  } | null
  payments?: Array<{ id: string; amount?: number | null; status?: string; paid_date?: string | null }>
  value: ConvertibleValue
}

export type ConvertibleSummary = {
  total_principal: number
  total_implied_value: number
  outstanding_count: number
}

export const useMyConvertibles = () => {
  const { data, ...rest } = useQuery({
    queryFn: () =>
      sdk.client.fetch<{
        convertibles: MyConvertible[]
        count: number
        summary: ConvertibleSummary
      }>("/investors/me/convertibles", { method: "GET" }),
    queryKey: ["investor-convertibles"] as const,
  })
  return {
    convertibles: data?.convertibles ?? [],
    count: data?.count ?? 0,
    summary: data?.summary ?? {
      total_principal: 0,
      total_implied_value: 0,
      outstanding_count: 0,
    },
    ...rest,
  }
}

export const useMyCapTable = () => {
  const { data, ...rest } = useQuery({
    queryFn: () =>
      sdk.client.fetch<{ cap_tables: InvestorCapTable[]; count: number }>(
        "/investors/me/cap-table",
        { method: "GET" }
      ),
    queryKey: investmentsQueryKeys.capTable,
  })
  return { capTables: data?.cap_tables ?? [], count: data?.count ?? 0, ...rest }
}

export const useDeals = () => {
  const { data, ...rest } = useQuery({
    queryFn: () =>
      sdk.client.fetch<{ deals: Deal[]; count: number }>("/investors/deals", {
        method: "GET",
      }),
    queryKey: investmentsQueryKeys.deals,
  })
  return { deals: data?.deals ?? [], count: data?.count ?? 0, ...rest }
}

export const useMyParticipations = () => {
  const { data, ...rest } = useQuery({
    queryFn: () =>
      sdk.client.fetch<{ participations: Participation[]; count: number }>(
        "/investors/me/participations",
        { method: "GET" }
      ),
    queryKey: investmentsQueryKeys.participations,
  })
  return { participations: data?.participations ?? [], count: data?.count ?? 0, ...rest }
}

export const useParticipate = (
  dealId: string,
  options?: UseMutationOptions<
    { stake?: any; convertible?: any },
    FetchError,
    { amount: number }
  >
) => {
  return useMutation({
    mutationFn: (payload) =>
      sdk.client.fetch<{ stake?: any; convertible?: any }>(
        `/investors/deals/${dealId}/participate`,
        {
          method: "POST",
          body: payload,
        }
      ),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: investmentsQueryKeys.deals })
      queryClient.invalidateQueries({ queryKey: investmentsQueryKeys.participations })
      queryClient.invalidateQueries({ queryKey: investmentsQueryKeys.capTable })
      queryClient.invalidateQueries({ queryKey: ["investor-convertibles"] })
      ;(options?.onSuccess as any)?.(data, variables, context)
    },
    ...options,
  })
}
