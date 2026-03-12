import { FetchError } from "@medusajs/js-sdk"
import { useQuery, UseQueryOptions, QueryKey, useMutation, UseMutationOptions, useQueryClient } from "@tanstack/react-query"
import { sdk } from "../../lib/config"
import { queryKeysFactory } from "../../lib/query-key-factory"

export interface AdminPaymentReport {
  id: string
  name?: string | null
  period_start: string
  period_end: string
  entity_type: "all" | "partner" | "person"
  entity_id?: string | null
  total_amount: number
  payment_count: number
  by_status: Record<string, number>
  by_type: Record<string, number>
  by_month?: Array<{ month: string; amount: number; count: number }> | null
  generated_at: string
  filters?: Record<string, any> | null
  metadata?: Record<string, any> | null
  created_at: string
  updated_at: string
}

export interface AdminPaymentReportsResponse {
  payment_reports: AdminPaymentReport[]
  count: number
  offset: number
  limit: number
}

export interface AdminPaymentReportsQuery {
  offset?: number
  limit?: number
  entity_type?: "all" | "partner" | "person"
  entity_id?: string
}

export interface AdminPaymentReportSummaryResponse {
  total_amount: number
  payment_count: number
  by_status: Record<string, number>
  by_type: Record<string, number>
  by_month: Array<{ month: string; amount: number; count: number }>
  payments: any[]
  count: number
  offset: number
  limit: number
  period_start?: string | null
  period_end?: string | null
}

export interface AdminPaymentReportsByPartnerResponse {
  by_partner: Array<{
    partner_id: string
    partner_name: string
    total_amount: number
    payment_count: number
    by_status: Record<string, number>
    by_type: Record<string, number>
  }>
  count: number
}

export interface AdminPaymentReportsByPersonResponse {
  by_person: Array<{
    person_id: string
    person_name: string
    total_amount: number
    payment_count: number
    by_status: Record<string, number>
    by_type: Record<string, number>
  }>
  count: number
}

export interface AdminReportingQuery {
  period_start?: string
  period_end?: string
  status?: "Pending" | "Processing" | "Completed" | "Failed" | "Cancelled"
  payment_type?: "Bank" | "Cash" | "Digital_Wallet"
  limit?: number
  offset?: number
}

export interface CreatePaymentReportPayload {
  name?: string
  period_start: string
  period_end: string
  entity_type?: "all" | "partner" | "person"
  entity_id?: string
  status?: "Pending" | "Processing" | "Completed" | "Failed" | "Cancelled"
  payment_type?: "Bank" | "Cash" | "Digital_Wallet"
  metadata?: Record<string, any>
}

export interface UpdatePaymentReportPayload {
  id: string
  name?: string
  metadata?: Record<string, any>
}

const PAYMENT_REPORTS_QUERY_KEY = "payment_reports" as const
export const paymentReportQueryKeys = queryKeysFactory(PAYMENT_REPORTS_QUERY_KEY)

export const usePaymentReports = (
  query?: AdminPaymentReportsQuery,
  options?: Omit<
    UseQueryOptions<AdminPaymentReportsResponse, FetchError, AdminPaymentReportsResponse, QueryKey>,
    "queryFn" | "queryKey"
  >,
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () =>
      sdk.client.fetch<AdminPaymentReportsResponse>(`/admin/payment_reports`, {
        method: "GET",
        query: query ?? {},
      }) as Promise<AdminPaymentReportsResponse>,
    queryKey: paymentReportQueryKeys.list(query),
    ...options,
  })
  return { ...data, ...rest }
}

export const usePaymentReport = (
  id: string,
  options?: Omit<
    UseQueryOptions<{ payment_report: AdminPaymentReport }, FetchError, { payment_report: AdminPaymentReport }, QueryKey>,
    "queryFn" | "queryKey"
  >,
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () =>
      sdk.client.fetch<{ payment_report: AdminPaymentReport }>(`/admin/payment_reports/${id}`, {
        method: "GET",
      }) as Promise<{ payment_report: AdminPaymentReport }>,
    queryKey: paymentReportQueryKeys.detail(id),
    enabled: !!id,
    ...options,
  })
  return { ...data, ...rest }
}

export const useCreatePaymentReport = (
  options?: UseMutationOptions<{ payment_report: AdminPaymentReport }, FetchError, CreatePaymentReportPayload>
) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: CreatePaymentReportPayload) =>
      sdk.client.fetch<{ payment_report: AdminPaymentReport }>(`/admin/payment_reports`, {
        method: "POST",
        body: payload,
      }) as Promise<{ payment_report: AdminPaymentReport }>,
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: paymentReportQueryKeys.lists() })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useUpdatePaymentReport = (
  options?: UseMutationOptions<{ payment_report: AdminPaymentReport }, FetchError, UpdatePaymentReportPayload>
) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...data }: UpdatePaymentReportPayload) =>
      sdk.client.fetch<{ payment_report: AdminPaymentReport }>(`/admin/payment_reports/${id}`, {
        method: "PATCH",
        body: data,
      }) as Promise<{ payment_report: AdminPaymentReport }>,
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: paymentReportQueryKeys.lists() })
      queryClient.invalidateQueries({ queryKey: paymentReportQueryKeys.detail(variables.id) })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useDeletePaymentReport = (
  options?: UseMutationOptions<void, FetchError, string>
) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await sdk.client.fetch(`/admin/payment_reports/${id}`, {
        method: "DELETE",
      })
    },
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: paymentReportQueryKeys.lists() })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const usePaymentReportSummary = (
  query?: AdminReportingQuery,
  options?: Omit<
    UseQueryOptions<AdminPaymentReportSummaryResponse, FetchError, AdminPaymentReportSummaryResponse, QueryKey>,
    "queryFn" | "queryKey"
  >,
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () =>
      sdk.client.fetch<AdminPaymentReportSummaryResponse>(`/admin/payment_reports/summary`, {
        method: "GET",
        query: query ?? {},
      }) as Promise<AdminPaymentReportSummaryResponse>,
    queryKey: [PAYMENT_REPORTS_QUERY_KEY, "summary", query],
    ...options,
  })
  return { ...data, ...rest }
}

export const usePaymentReportsByPartner = (
  query?: AdminReportingQuery,
  options?: Omit<
    UseQueryOptions<AdminPaymentReportsByPartnerResponse, FetchError, AdminPaymentReportsByPartnerResponse, QueryKey>,
    "queryFn" | "queryKey"
  >,
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () =>
      sdk.client.fetch<AdminPaymentReportsByPartnerResponse>(`/admin/payment_reports/by-partner`, {
        method: "GET",
        query: query ?? {},
      }) as Promise<AdminPaymentReportsByPartnerResponse>,
    queryKey: [PAYMENT_REPORTS_QUERY_KEY, "by-partner", query],
    ...options,
  })
  return { ...data, ...rest }
}

export const usePaymentReportsByPerson = (
  query?: AdminReportingQuery,
  options?: Omit<
    UseQueryOptions<AdminPaymentReportsByPersonResponse, FetchError, AdminPaymentReportsByPersonResponse, QueryKey>,
    "queryFn" | "queryKey"
  >,
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () =>
      sdk.client.fetch<AdminPaymentReportsByPersonResponse>(`/admin/payment_reports/by-person`, {
        method: "GET",
        query: query ?? {},
      }) as Promise<AdminPaymentReportsByPersonResponse>,
    queryKey: [PAYMENT_REPORTS_QUERY_KEY, "by-person", query],
    ...options,
  })
  return { ...data, ...rest }
}
