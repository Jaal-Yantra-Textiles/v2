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
  status?: string
  target_amount?: number | null
  raised_amount?: number | null
  price_per_share?: number | null
  pre_money_valuation?: number | null
  close_date?: string | null
  cap_table?: { company_id?: string; name?: string; currency_code?: string | null } | null
}

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

export const investmentsQueryKeys = {
  deals: ["investor-deals"] as const,
  participations: ["investor-participations"] as const,
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
  options?: UseMutationOptions<{ stake: any }, FetchError, { amount: number }>
) => {
  return useMutation({
    mutationFn: (payload) =>
      sdk.client.fetch<{ stake: any }>(`/investors/deals/${dealId}/participate`, {
        method: "POST",
        body: payload,
      }),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: investmentsQueryKeys.deals })
      queryClient.invalidateQueries({ queryKey: investmentsQueryKeys.participations })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}
