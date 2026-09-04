import { FetchError } from "@medusajs/js-sdk"
import {
  QueryKey,
  UseMutationOptions,
  UseQueryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"

import { sdk } from "../../lib/config"
import { queryKeysFactory } from "../../lib/query-key-factory"

/**
 * Export LUTs + the resolved export IGST status (#1216).
 *
 * An LUT (GST form RFD-11) covers ONE financial year and must be re-furnished
 * each April. `useExportIgstStatus` is deliberately a SEPARATE query from the LUT
 * list: the list says what rows exist, the status says what a label would declare
 * *today*. They diverge the moment an LUT lapses — which is the whole failure this
 * feature prevents — so the UI must never infer the status from the rows itself.
 */

const EXPORT_LUTS_QUERY_KEY = "export-luts" as const
export const exportLutQueryKeys = queryKeysFactory(EXPORT_LUTS_QUERY_KEY)

const EXPORT_IGST_QUERY_KEY = "export-igst-status" as const
export const exportIgstQueryKeys = queryKeysFactory(EXPORT_IGST_QUERY_KEY)

export type AdminExportLut = {
  id: string
  arn: string
  financial_year: string
  valid_from: string
  valid_to: string
  filed_on: string | null
  notes: string | null
  is_active: boolean
  created_at?: string
}

export type AdminPlatformTaxIdentity = {
  id: string
  brand_code: string
  legal_name: string
  tax_id: string
  tax_id_type: string
  country_codes: string[] | null
  is_active: boolean
  export_luts?: AdminExportLut[] | null
}

export type AdminPlatformTaxIdentitiesResponse = {
  platform_tax_identities: AdminPlatformTaxIdentity[]
}

export type AdminExportLutsResponse = { export_luts: AdminExportLut[] }
export type AdminExportLutResponse = { export_lut: AdminExportLut }

/** "B" = LUT/bond on file, no IGST paid. "C" = IGST paid and reclaimed. */
export type AdminExportIgstStatus = {
  status: "B" | "C"
  declares_under_lut: boolean
  lut_arn?: string
  financial_year?: string
  days_until_expiry?: number
}

export type AdminExportIgstResponse = { export_igst: AdminExportIgstStatus }

export type AdminCreateExportLutPayload = {
  arn: string
  financial_year: string
  valid_from: string
  valid_to: string
  filed_on?: string
  notes?: string
  is_active?: boolean
}

export type AdminUpdateExportLutPayload = Partial<AdminCreateExportLutPayload>

// --- Queries ---

export const usePlatformTaxIdentities = (
  options?: Omit<
    UseQueryOptions<
      AdminPlatformTaxIdentitiesResponse,
      FetchError,
      AdminPlatformTaxIdentitiesResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: ["platform-tax-identities"],
    queryFn: async () =>
      sdk.client.fetch<AdminPlatformTaxIdentitiesResponse>(
        `/admin/platform-tax-identities`,
        { method: "GET" }
      ),
    ...options,
  })

  return { ...data, ...rest }
}

export const useExportLuts = (
  identityId: string,
  options?: Omit<
    UseQueryOptions<AdminExportLutsResponse, FetchError, AdminExportLutsResponse, QueryKey>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: exportLutQueryKeys.list({ identityId }),
    queryFn: async () =>
      sdk.client.fetch<AdminExportLutsResponse>(
        `/admin/platform-tax-identities/${identityId}/export-luts`,
        { method: "GET" }
      ),
    ...options,
  })

  return { ...data, ...rest }
}

/** What an export label would declare RIGHT NOW, and which LUT justifies it. */
export const useExportIgstStatus = (
  options?: Omit<
    UseQueryOptions<AdminExportIgstResponse, FetchError, AdminExportIgstResponse, QueryKey>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: exportIgstQueryKeys.details(),
    queryFn: async () =>
      sdk.client.fetch<AdminExportIgstResponse>(
        `/admin/customs/export-igst-status`,
        { method: "GET" }
      ),
    ...options,
  })

  return { ...data, ...rest }
}

// --- Mutations ---

/**
 * Every mutation invalidates the STATUS as well as the list. Recording, editing
 * or withdrawing an LUT changes what the next label declares, and a stale banner
 * claiming "declaring under LUT" after a withdrawal is exactly the wrong thing to
 * show for a compliance surface.
 */
const invalidateLutQueries = (queryClient: any, identityId: string) => {
  queryClient.invalidateQueries({ queryKey: exportLutQueryKeys.list({ identityId }) })
  queryClient.invalidateQueries({ queryKey: exportLutQueryKeys.lists() })
  queryClient.invalidateQueries({ queryKey: exportIgstQueryKeys.details() })
  queryClient.invalidateQueries({ queryKey: ["platform-tax-identities"] })
}

export const useCreateExportLut = (
  identityId: string,
  options?: UseMutationOptions<
    AdminExportLutResponse,
    FetchError,
    AdminCreateExportLutPayload
  >
) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: AdminCreateExportLutPayload) =>
      sdk.client.fetch<AdminExportLutResponse>(
        `/admin/platform-tax-identities/${identityId}/export-luts`,
        { method: "POST", body: payload }
      ),
    ...options,
    onSuccess: (data, variables, _mr, context) => {
      invalidateLutQueries(queryClient, identityId)
      options?.onSuccess?.(data, variables, _mr, context)
    },
  })
}

export const useUpdateExportLut = (
  identityId: string,
  lutId: string,
  options?: UseMutationOptions<
    AdminExportLutResponse,
    FetchError,
    AdminUpdateExportLutPayload
  >
) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: AdminUpdateExportLutPayload) =>
      sdk.client.fetch<AdminExportLutResponse>(
        `/admin/platform-tax-identities/${identityId}/export-luts/${lutId}`,
        { method: "POST", body: payload }
      ),
    ...options,
    onSuccess: (data, variables, _mr, context) => {
      invalidateLutQueries(queryClient, identityId)
      options?.onSuccess?.(data, variables, _mr, context)
    },
  })
}

export const useDeleteExportLut = (
  identityId: string,
  lutId: string,
  options?: UseMutationOptions<{ id: string; deleted: boolean }, FetchError, void>
) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () =>
      sdk.client.fetch<{ id: string; deleted: boolean }>(
        `/admin/platform-tax-identities/${identityId}/export-luts/${lutId}`,
        { method: "DELETE" }
      ),
    ...options,
    onSuccess: (data, variables, _mr, context) => {
      invalidateLutQueries(queryClient, identityId)
      options?.onSuccess?.(data, variables, _mr, context)
    },
  })
}
