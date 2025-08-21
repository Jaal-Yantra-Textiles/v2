import { FetchError } from "@medusajs/js-sdk"
import { useQuery, UseQueryOptions, QueryKey, useMutation, UseMutationOptions, useQueryClient } from "@tanstack/react-query"
import { sdk } from "../../lib/config"
import { queryKeysFactory } from "../../lib/query-key-factory"

export type AdminPartnerAdmin = {
  id: string
  email: string
  first_name?: string
  last_name?: string
  phone?: string
  role?: "owner" | "admin" | "manager"
}

export interface AdminPartner {
  id: string
  name: string
  handle: string
  logo?: string | null
  status: "active" | "inactive" | "pending"
  is_verified: boolean
  metadata?: Record<string, any> | null
  created_at: string
  updated_at: string
  admins?: AdminPartnerAdmin[]
}

export interface AdminPartnersResponse {
  partners: AdminPartner[]
  count: number
  offset: number
  limit: number
}

export interface AdminPartnersQuery {
  offset?: number
  limit?: number
  name?: string
  handle?: string
  status?: "active" | "inactive" | "pending"
  is_verified?: boolean
  fields?: string[]
}

const PARTNERS_QUERY_KEY = "admin_partners" as const
export const partnersQueryKeys = queryKeysFactory(PARTNERS_QUERY_KEY)

export const usePartners = (
  query?: AdminPartnersQuery,
  options?: Omit<
    UseQueryOptions<AdminPartnersResponse, FetchError, AdminPartnersResponse, QueryKey>,
    "queryFn" | "queryKey"
  >,
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () =>
      sdk.client.fetch<AdminPartnersResponse>(`/admin/partners`, {
        method: "GET",
        query: {
          ...query,
          fields: query?.fields ? query.fields.join(",") : undefined,
        },
      }) as Promise<AdminPartnersResponse>,
    queryKey: partnersQueryKeys.list(query),
    ...options,
  })
  return { ...data, ...rest }
}

export const usePartner = (
  id: string,
  fields?: string[],
  options?: Omit<UseQueryOptions<{ partner: AdminPartner }, FetchError, { partner: AdminPartner }, QueryKey>, "queryFn" | "queryKey">,
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () =>
      sdk.client.fetch<{ partner: AdminPartner }>(`/admin/partners/${id}`, {
        method: "GET",
        query: {
          fields: fields?.length ? fields.join(",") : undefined,
        },
      }) as Promise<{ partner: AdminPartner }>,
    queryKey: partnersQueryKeys.detail(id, { fields }),
    enabled: !!id,
    ...options,
  })
  return { ...data, ...rest }
}

export const useUpdatePartner = () => {
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<AdminPartner> }) => {
      return sdk.client.fetch<{ partner: AdminPartner }>(`/admin/partners/${id}`, {
        method: "PUT",
        body: data,
      })
    },
  })
}

// Create partner with admin
export type CreatePartnerWithAdminPayload = {
  partner: {
    name: string
    handle?: string
    logo?: string
    status?: "active" | "inactive" | "pending"
    is_verified?: boolean
  }
  admin: {
    email: string
    first_name?: string
    last_name?: string
    phone?: string
    role?: "owner" | "admin" | "manager"
  }
  auth_identity_id?: string
}

export type CreatePartnerWithAdminResponse = {
  partner: AdminPartner
  partner_admin: AdminPartnerAdmin
}

export const useCreatePartnerWithAdmin = (
  options?: UseMutationOptions<CreatePartnerWithAdminResponse, FetchError, CreatePartnerWithAdminPayload>
) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: CreatePartnerWithAdminPayload) =>
      sdk.client.fetch<CreatePartnerWithAdminResponse>(`/admin/partners`, {
        method: "POST",
        body: payload,
      }) as Promise<CreatePartnerWithAdminResponse>,
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: partnersQueryKeys.lists() })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}
