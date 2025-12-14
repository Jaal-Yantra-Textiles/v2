import { FetchError } from "@medusajs/js-sdk"
import { HttpTypes } from "@medusajs/types"
import {
  QueryKey,
  UseMutationOptions,
  UseQueryOptions,
  useMutation,
  useQuery,
} from "@tanstack/react-query"
import { sdk } from "../../lib/client"
import { queryClient } from "../../lib/query-client"
import { queryKeysFactory } from "../../lib/query-key-factory"

const USERS_QUERY_KEY = "users" as const
const usersQueryKeys = {
  ...queryKeysFactory(USERS_QUERY_KEY),
  me: () => [USERS_QUERY_KEY, "me"],
}

export type PartnerAdmin = {
  id: string
  first_name?: string | null
  last_name?: string | null
  email?: string | null
  phone?: string | null
  role?: string | null
  metadata?: Record<string, any> | null
}

type PartnerDetails = {
  id: string
  name?: string | null
  handle?: string | null
  logo?: string | null
  status?: string | null
  is_verified?: boolean | null
  metadata?: Record<string, any> | null
  admins?: PartnerAdmin[] | null
}

type PartnerDetailsResponse = {
  partner?: PartnerDetails | null
}

export type PartnerUser = PartnerAdmin & {
  partner_id: string
  partner?: PartnerDetails
}

export type PartnerUserResponse = {
  user: PartnerUser | null
}

const fetchPartnerUser = async (): Promise<PartnerUserResponse> => {
  const response = await sdk.client.fetch<PartnerDetailsResponse>(
    "/partners/details",
    {
      method: "GET",
    }
  )
  return mapPartnerResponseToUser(response)
}

const mapPartnerResponseToUser = (
  response: PartnerDetailsResponse
): PartnerUserResponse => {
  const partner = response.partner

  if (!partner) {
    return { user: null }
  }

  const admins = Array.isArray(partner.admins)
    ? partner.admins.filter((admin): admin is PartnerAdmin => Boolean(admin))
    : []

  const ownerAdmin =
    admins.find((admin) => admin.role === "owner") ?? admins[0] ?? null

  if (!ownerAdmin) {
    return {
      user: {
        id: partner.id,
        first_name: partner.name ?? undefined,
        last_name: undefined,
        email:
          (partner.metadata as Record<string, any> | undefined)?.contact_email ??
          undefined,
        metadata: partner.metadata ?? undefined,
        partner_id: partner.id,
        partner,
      },
    }
  }

  return {
    user: {
      ...ownerAdmin,
      partner_id: partner.id,
      partner,
    },
  }
}

export const useMe = (
  options?: UseQueryOptions<
    PartnerUserResponse,
    FetchError,
    PartnerUserResponse,
    QueryKey
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: fetchPartnerUser,
    queryKey: usersQueryKeys.me(),
    ...options,
  })

  return {
    ...data,
    user: data?.user ?? null,
    ...rest,
  }
}

export const useUser = (
  id: string,
  query?: HttpTypes.AdminUserParams,
  options?: Omit<
    UseQueryOptions<
      HttpTypes.AdminUserResponse,
      FetchError,
      HttpTypes.AdminUserResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () => sdk.admin.user.retrieve(id, query),
    queryKey: usersQueryKeys.detail(id),
    ...options,
  })

  return { ...data, ...rest }
}

export const useUsers = (
  query?: HttpTypes.AdminUserListParams,
  options?: Omit<
    UseQueryOptions<
      HttpTypes.AdminUserListResponse,
      FetchError,
      HttpTypes.AdminUserListResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () => sdk.admin.user.list(query),
    queryKey: usersQueryKeys.list(query),
    ...options,
  })

  return { ...data, ...rest }
}

export const useUpdateUser = (
  id: string,
  query?: HttpTypes.AdminUserParams,
  options?: UseMutationOptions<
    HttpTypes.AdminUserResponse,
    FetchError,
    HttpTypes.AdminUpdateUser,
    QueryKey
  >
) => {
  return useMutation({
    mutationFn: (payload) => sdk.admin.user.update(id, payload, query),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: usersQueryKeys.detail(id) })
      queryClient.invalidateQueries({ queryKey: usersQueryKeys.lists() })

      // We invalidate the me query in case the user updates their own profile
      queryClient.invalidateQueries({ queryKey: usersQueryKeys.me() })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useDeleteUser = (
  id: string,
  options?: UseMutationOptions<
    HttpTypes.AdminUserDeleteResponse,
    FetchError,
    void
  >
) => {
  return useMutation({
    mutationFn: () => sdk.admin.user.delete(id),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: usersQueryKeys.detail(id) })
      queryClient.invalidateQueries({ queryKey: usersQueryKeys.lists() })

      // We invalidate the me query in case the user updates their own profile
      queryClient.invalidateQueries({ queryKey: usersQueryKeys.me() })

      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}
