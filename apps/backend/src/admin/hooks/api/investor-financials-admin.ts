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
import { companiesQueryKeys } from "./companies-admin"

// ---- Types -----------------------------------------------------------------

export type AdminPayment = {
  id: string
  investor_id?: string | null
  amount?: number | null
  currency_code?: string | null
  payment_type?: string
  status?: string
  method?: string | null
  reference_number?: string | null
  due_date?: string | null
  paid_date?: string | null
  notes?: string | null
  created_at?: string
}

export type AdminDocument = {
  id: string
  title: string
  description?: string | null
  document_type?: string
  file_url?: string | null
  file_name?: string | null
  visibility?: string
  created_at?: string
}

export type RecordPaymentPayload = {
  amount: number
  currency_code?: string
  payment_type?: string
  status?: string
  method?: string | null
  reference_number?: string | null
  notes?: string | null
}

export type AddDocumentPayload = {
  title: string
  document_type?: string
  file_key: string
  file_url?: string | null
  file_name?: string | null
  mime_type?: string | null
  file_size?: number | null
  visibility?: string
  description?: string | null
}

export type UpdateCompanyCompliancePayload = {
  registration_number?: string | null
  tax_id?: string | null
  status?: "Active" | "Inactive" | "Pending" | "Suspended"
  founded_date?: string | null
  industry?: string | null
}

// ---- Query keys ------------------------------------------------------------

export const financeQueryKeys = {
  payments: (companyId: string) => ["admin-company-payments", companyId] as const,
  documents: (companyId: string, type?: string) =>
    ["admin-company-documents", companyId, type ?? "all"] as const,
}

// ---- Payments (Financials) -------------------------------------------------

export const useCompanyPayments = (
  companyId: string,
  options?: Omit<
    UseQueryOptions<{ payments: AdminPayment[]; count: number }, FetchError, { payments: AdminPayment[]; count: number }, QueryKey>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () =>
      sdk.client.fetch<{ payments: AdminPayment[]; count: number }>(
        `/admin/companies/${companyId}/payments`,
        { method: "GET" }
      ),
    queryKey: financeQueryKeys.payments(companyId),
    ...options,
  })
  return { ...data, ...rest }
}

export const useRecordPayment = (
  companyId: string,
  options?: UseMutationOptions<{ payment: AdminPayment }, FetchError, RecordPaymentPayload>
) => {
  const queryClient = useQueryClient()
  return useMutation({
    ...options,
    mutationFn: (payload) =>
      sdk.client.fetch(`/admin/companies/${companyId}/payments`, {
        method: "POST",
        body: payload,
      }),
    onSuccess: (...args: any[]) => {
      queryClient.invalidateQueries({ queryKey: financeQueryKeys.payments(companyId) })
      ;(options?.onSuccess as any)?.(...args)
    },
  })
}

// ---- Documents (Compliance vault) ------------------------------------------

export const useCompanyDocuments = (
  companyId: string,
  documentType?: string,
  options?: Omit<
    UseQueryOptions<{ documents: AdminDocument[]; count: number }, FetchError, { documents: AdminDocument[]; count: number }, QueryKey>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () =>
      sdk.client.fetch<{ documents: AdminDocument[]; count: number }>(
        `/admin/companies/${companyId}/documents`,
        { method: "GET", query: documentType ? { document_type: documentType } : undefined }
      ),
    queryKey: financeQueryKeys.documents(companyId, documentType),
    ...options,
  })
  return { ...data, ...rest }
}

export const useAddDocument = (
  companyId: string,
  options?: UseMutationOptions<{ document: AdminDocument }, FetchError, AddDocumentPayload>
) => {
  const queryClient = useQueryClient()
  return useMutation({
    ...options,
    mutationFn: (payload) =>
      sdk.client.fetch(`/admin/companies/${companyId}/documents`, {
        method: "POST",
        body: payload,
      }),
    onSuccess: (...args: any[]) => {
      queryClient.invalidateQueries({ queryKey: ["admin-company-documents", companyId] })
      ;(options?.onSuccess as any)?.(...args)
    },
  })
}

// ---- Company compliance fields ---------------------------------------------

export const useUpdateCompanyCompliance = (
  companyId: string,
  options?: UseMutationOptions<{ company: any }, FetchError, UpdateCompanyCompliancePayload>
) => {
  const queryClient = useQueryClient()
  return useMutation({
    ...options,
    mutationFn: (payload) =>
      sdk.client.fetch(`/admin/companies/${companyId}`, {
        method: "POST",
        body: payload,
      }),
    onSuccess: (...args: any[]) => {
      queryClient.invalidateQueries({ queryKey: companiesQueryKeys.detail(companyId) })
      ;(options?.onSuccess as any)?.(...args)
    },
  })
}
