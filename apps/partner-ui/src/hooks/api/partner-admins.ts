import { FetchError } from "@medusajs/js-sdk"
import {
  QueryKey,
  UseQueryOptions,
  useMutation,
  useQuery,
} from "@tanstack/react-query"
import { sdk } from "../../lib/client"
import { queryClient } from "../../lib/query-client"
import { queryKeysFactory } from "../../lib/query-key-factory"

const PARTNER_ADMINS_QUERY_KEY = "partner_admins" as const
export const partnerAdminsQueryKeys = queryKeysFactory(PARTNER_ADMINS_QUERY_KEY)

export type PartnerAdminRecord = {
  id: string
  first_name?: string | null
  last_name?: string | null
  email: string
  phone?: string | null
  role?: "owner" | "admin" | "manager" | null
  is_active?: boolean
  created_at?: string | null
}

type ListAdminsResponse = {
  admins: PartnerAdminRecord[]
  count: number
}

export const usePartnerAdmins = (
  options?: Omit<
    UseQueryOptions<ListAdminsResponse, FetchError, ListAdminsResponse, QueryKey>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () =>
      sdk.client.fetch<ListAdminsResponse>("/partners/admins", {
        method: "GET",
      }),
    queryKey: partnerAdminsQueryKeys.list(),
    ...options,
  })
  return { admins: data?.admins || [], count: data?.count || 0, ...rest }
}

type AddAdminPayload = {
  email: string
  first_name?: string
  last_name?: string
  phone?: string
  role?: "owner" | "admin" | "manager"
  password?: string
}

type AddAdminResponse = {
  admin: PartnerAdminRecord
  temp_password: string
}

export const useAddPartnerAdmin = () => {
  return useMutation({
    mutationFn: (payload: AddAdminPayload) =>
      sdk.client.fetch<AddAdminResponse>("/partners/admins", {
        method: "POST",
        body: payload,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: partnerAdminsQueryKeys.lists() })
      queryClient.invalidateQueries({ queryKey: ["users", "me"] })
    },
  })
}
