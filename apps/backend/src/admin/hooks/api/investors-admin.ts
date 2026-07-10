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

export type AdminInvestor = {
  id: string
  name: string
  handle?: string
  email?: string
  status?: string
  investor_type?: "individual" | "entity" | "fund"
  created_at?: string
  updated_at?: string
}

export type AdminInvestorsResponse = {
  investors: AdminInvestor[]
  count: number
  offset: number
  limit: number
}

// Payload for inviting an investor. Mirrors the `investorSchema` the backend
// validates on POST /admin/investors (investor fields + a primary admin).
export type InviteInvestorPayload = {
  name: string
  // The investor entity requires its own email (schema-required); the invite
  // form reuses the primary contact email for it.
  email: string
  investor_type?: "individual" | "entity" | "fund"
  legal_name?: string
  admin: {
    email: string
    first_name?: string
    last_name?: string
    phone?: string
  }
}

const INVESTORS_QUERY_KEY = "admin-investors" as const
export const investorsQueryKeys = queryKeysFactory(INVESTORS_QUERY_KEY)

export const useInvestors = (
  query?: Record<string, any>,
  options?: Omit<
    UseQueryOptions<
      AdminInvestorsResponse,
      FetchError,
      AdminInvestorsResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () =>
      sdk.client.fetch<AdminInvestorsResponse>(`/admin/investors`, {
        method: "GET",
        query,
      }),
    queryKey: investorsQueryKeys.list(query),
    ...options,
  })

  return { ...data, ...rest }
}

export const useInviteInvestor = (
  options?: UseMutationOptions<
    { investor: AdminInvestor; investor_admin: unknown },
    FetchError,
    InviteInvestorPayload
  >
) => {
  const queryClient = useQueryClient()

  return useMutation({
    ...options,
    mutationFn: (payload) =>
      sdk.client.fetch(`/admin/investors`, {
        method: "POST",
        body: payload,
      }),
    // Spread `...options` first so our onSuccess (with cache invalidation) wins,
    // then forward all args to the caller's handler (…args sidesteps react-query
    // 5.90's mutation-callback arity).
    onSuccess: (...args: any[]) => {
      queryClient.invalidateQueries({ queryKey: investorsQueryKeys.lists() })
      ;(options?.onSuccess as any)?.(...args)
    },
  })
}
