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

export type AdminCompany = {
  id: string
  name: string
  legal_name?: string
  email?: string
  industry?: string
  status?: string
  created_at?: string
  updated_at?: string
}

export type AdminCompaniesResponse = {
  companies: AdminCompany[]
  count: number
  offset: number
  limit: number
}

export type CreateCompanyPayload = {
  name: string
  legal_name: string
  email: string
  phone: string
  address: string
  city: string
  state: string
  country: string
  postal_code: string
  website?: string
  industry?: string
  description?: string
}

export type CompanyInvestor = {
  id: string
  name: string
  email?: string
  investor_type?: string
  pipeline_stage?: string
  pipeline_status?: string
}

export type CompanyInvestorsResponse = {
  investors: CompanyInvestor[]
  count: number
}

export type InviteInvestorToCompanyPayload = {
  name: string
  email: string
  investor_type?: string
  legal_name?: string
  admin: {
    email: string
    first_name?: string
    last_name?: string
    phone?: string
  }
}

const COMPANIES_QUERY_KEY = "admin-companies" as const
export const companiesQueryKeys = queryKeysFactory(COMPANIES_QUERY_KEY)

export const useCompanies = (
  query?: Record<string, any>,
  options?: Omit<
    UseQueryOptions<
      AdminCompaniesResponse,
      FetchError,
      AdminCompaniesResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () =>
      sdk.client.fetch<AdminCompaniesResponse>(`/admin/companies`, {
        method: "GET",
        query,
      }),
    queryKey: companiesQueryKeys.list(query),
    ...options,
  })

  return { ...data, ...rest }
}

export const useCompany = (
  id: string,
  options?: Omit<
    UseQueryOptions<
      { company: AdminCompany },
      FetchError,
      { company: AdminCompany },
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () =>
      sdk.client.fetch<{ company: AdminCompany }>(`/admin/companies/${id}`, {
        method: "GET",
      }),
    queryKey: companiesQueryKeys.detail(id),
    ...options,
  })

  return { ...data, ...rest }
}

export const useCreateCompany = (
  options?: UseMutationOptions<
    { company: AdminCompany },
    FetchError,
    CreateCompanyPayload
  >
) => {
  const queryClient = useQueryClient()

  return useMutation({
    ...options,
    mutationFn: (payload) =>
      sdk.client.fetch(`/admin/companies`, {
        method: "POST",
        body: payload,
      }),
    // Spread `...options` first so our onSuccess (with cache invalidation) wins,
    // then forward all args to the caller's handler (…args sidesteps react-query
    // 5.90's mutation-callback arity).
    onSuccess: (...args: any[]) => {
      queryClient.invalidateQueries({ queryKey: companiesQueryKeys.lists() })
      ;(options?.onSuccess as any)?.(...args)
    },
  })
}

export const useCompanyInvestors = (
  companyId: string,
  options?: Omit<
    UseQueryOptions<
      CompanyInvestorsResponse,
      FetchError,
      CompanyInvestorsResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () =>
      sdk.client.fetch<CompanyInvestorsResponse>(
        `/admin/companies/${companyId}/investors`,
        {
          method: "GET",
        }
      ),
    queryKey: ["admin-company-investors", companyId],
    ...options,
  })

  return { ...data, ...rest }
}

export const useInviteInvestorToCompany = (
  companyId: string,
  options?: UseMutationOptions<
    { investor: CompanyInvestor; investor_admin: unknown },
    FetchError,
    InviteInvestorToCompanyPayload
  >
) => {
  const queryClient = useQueryClient()

  return useMutation({
    ...options,
    mutationFn: (payload) =>
      sdk.client.fetch(`/admin/companies/${companyId}/investors`, {
        method: "POST",
        body: payload,
      }),
    // Spread `...options` first so our onSuccess (with cache invalidation) wins,
    // then forward all args to the caller's handler (…args sidesteps react-query
    // 5.90's mutation-callback arity).
    onSuccess: (...args: any[]) => {
      queryClient.invalidateQueries({
        queryKey: ["admin-company-investors", companyId],
      })
      queryClient.invalidateQueries({ queryKey: companiesQueryKeys.lists() })
      ;(options?.onSuccess as any)?.(...args)
    },
  })
}
