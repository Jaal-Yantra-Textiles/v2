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

// Investor UI: the "current user" is the authenticated investor. All hooks here
// talk to the investor-scoped API (/investors/me) — NOT the admin user API. The
// gutted-dashboard admin user hooks (useUser/useUsers/useUpdateUser/…) were
// removed: an investor actor has no admin access, so those calls only 401/403.

const USERS_QUERY_KEY = "users" as const
const usersQueryKeys = {
  ...queryKeysFactory(USERS_QUERY_KEY),
  me: (query?: HttpTypes.AdminUserParams) =>
    [USERS_QUERY_KEY, "me", query ? { query } : undefined].filter((k) => !!k),
}

export const useMe = (
  query?: HttpTypes.AdminUserParams,
  options?: UseQueryOptions<
    HttpTypes.AdminUserResponse,
    FetchError,
    HttpTypes.AdminUserResponse,
    QueryKey
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: async () => {
      const { investor } = await sdk.client.fetch<{
        investor: HttpTypes.AdminUser
      }>("/investors/me")
      return { user: investor } as HttpTypes.AdminUserResponse
    },
    queryKey: usersQueryKeys.me(query),
    ...options,
  })

  return {
    ...data,
    ...rest,
  }
}

// Update the authenticated investor (POST /investors/me). Used by onboarding
// and profile edits. Accepts any subset of the investor update schema —
// notably `metadata` (where onboarding answers live). Invalidates the me query.
export const useUpdateMe = (
  options?: UseMutationOptions<
    { investor: Record<string, any> },
    FetchError,
    Record<string, any>
  >
) => {
  return useMutation({
    mutationFn: (payload) =>
      sdk.client.fetch<{ investor: Record<string, any> }>("/investors/me", {
        method: "POST",
        body: payload,
      }),
    onSuccess: async (data, variables, context) => {
      await queryClient.refetchQueries({ queryKey: usersQueryKeys.me() })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}
