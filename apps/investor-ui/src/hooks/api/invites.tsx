import { FetchError } from "@medusajs/js-sdk"
import { HttpTypes } from "@medusajs/types"
import {
  QueryKey,
  UseMutationOptions,
  UseQueryOptions,
  useMutation,
  useQuery,
} from "@tanstack/react-query"
import { queryClient } from "../../lib/query-client"
import { queryKeysFactory } from "../../lib/query-key-factory"

const INVITES_QUERY_KEY = "invites" as const
const invitesQueryKeys = queryKeysFactory(INVITES_QUERY_KEY)

export const useInvite = (
  id: string,
  options?: Omit<
    UseQueryOptions<
      HttpTypes.AdminInviteResponse,
      FetchError,
      HttpTypes.AdminInviteResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: invitesQueryKeys.detail(id),
    // investor-ui: admin API disabled (was sdk.admin.invite.retrieve) — avoids 401→logout
    queryFn: async () =>
      ({} as unknown as HttpTypes.AdminInviteResponse),
    ...options,
  })

  return { ...data, ...rest }
}

export const useInvites = (
  query?: Record<string, any>,
  options?: Omit<
    UseQueryOptions<
      HttpTypes.AdminInviteListResponse,
      FetchError,
      HttpTypes.AdminInviteListResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    // investor-ui: admin API disabled (was sdk.admin.invite.list) — avoids 401→logout
    queryFn: async () =>
      ({
        invites: [],
        count: 0,
        offset: 0,
        limit: 0,
      } as unknown as HttpTypes.AdminInviteListResponse),
    queryKey: invitesQueryKeys.list(query),
    ...options,
  })

  return { ...data, ...rest }
}

export const useCreateInvite = (
  options?: UseMutationOptions<
    HttpTypes.AdminInviteResponse,
    FetchError,
    HttpTypes.AdminCreateInvite
  >
) => {
  return useMutation({
    // investor-ui: admin API disabled (was sdk.admin.invite.create) — avoids 401→logout
    mutationFn: async () => ({} as unknown as HttpTypes.AdminInviteResponse),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: invitesQueryKeys.lists() })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useResendInvite = (
  id: string,
  options?: UseMutationOptions<HttpTypes.AdminInviteResponse, FetchError, void>
) => {
  return useMutation({
    // investor-ui: admin API disabled (was sdk.admin.invite.resend) — avoids 401→logout
    mutationFn: async () => ({} as unknown as HttpTypes.AdminInviteResponse),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: invitesQueryKeys.lists() })
      queryClient.invalidateQueries({ queryKey: invitesQueryKeys.detail(id) })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useDeleteInvite = (
  id: string,
  options?: UseMutationOptions<
    HttpTypes.AdminInviteDeleteResponse,
    FetchError,
    void
  >
) => {
  return useMutation({
    // investor-ui: admin API disabled (was sdk.admin.invite.delete) — avoids 401→logout
    mutationFn: async () =>
      ({} as unknown as HttpTypes.AdminInviteDeleteResponse),
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: invitesQueryKeys.lists() })
      queryClient.invalidateQueries({ queryKey: invitesQueryKeys.detail(id) })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useAcceptInvite = (
  _inviteToken: string,
  options?: UseMutationOptions<
    HttpTypes.AdminAcceptInviteResponse,
    FetchError,
    HttpTypes.AdminAcceptInvite & { auth_token: string }
  >
) => {
  return useMutation({
    // investor-ui: admin API disabled (was sdk.admin.invite.accept) — avoids 401→logout
    mutationFn: async () =>
      ({} as unknown as HttpTypes.AdminAcceptInviteResponse),
    onSuccess: (data, variables, context) => {
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}
